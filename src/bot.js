require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Telegraf, Markup } = require('telegraf');
const axios = require('axios');

// controllers/fileController va utils/textParser ni alohida fayllardan import qilish shart
// Ular loyihada mavjud deb faraz qilinadi.
const { processFileFromUrl } = require('./controllers/fileController'); 
const { extractQuestions } = require('./utils/textParser'); 

const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_ID = Number(process.env.ADMIN_ID); 

if (!BOT_TOKEN) {
  console.error('❌ BOT_TOKEN .env faylida topilmadi!');
  process.exit(1);
}
if (isNaN(ADMIN_ID) || ADMIN_ID === 0) {
    console.warn('⚠️ ADMIN_ID o‘rnatilmagan yoki noto‘g‘ri. Admin funksiyalari ishlamasligi mumkin.');
}

const bot = new Telegraf(BOT_TOKEN);

// === Fayl yo‘llari (DB) ===
const dbDir = path.join(__dirname, 'db');
const usersDbPath = path.join(dbDir, 'users.json');
const answersDbPath = path.join(dbDir, 'answers.json');
const uploadsDir = path.join(__dirname, 'uploads');
const questionsPath = path.join(uploadsDir, 'lastQuestions.json');

// === JSON funksiyalari ===
function readJson(p) {
  try {
    if (!fs.existsSync(p)) return (p === questionsPath ? { questions: [] } : []);
    const data = fs.readFileSync(p, 'utf8');
    return data ? JSON.parse(data) : (p === questionsPath ? { questions: [] } : []);
  } catch (e) {
    console.error(`JSON o'qishda xato: ${p}`, e.message);
    return (p === questionsPath ? { questions: [] } : []);
  }
}
function writeJson(p, data) {
  try {
    const dir = path.dirname(p);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(p, JSON.stringify(data, null, 2), 'utf8');
  } catch (e) {
    console.error(`JSON yozishda xato: ${p}`, e.message);
  }
}

// === Holatlar (RAMda saqlanadi) ===
const userState = {}; 

// === Foydalanuvchini topish yoki saqlash ===
function findUser(id) {
  const users = readJson(usersDbPath);
  return users.find(u => u.id === id);
}
function saveUser(user) {
  const users = readJson(usersDbPath);
  const idx = users.findIndex(u => u.id === user.id);
  if (idx >= 0) users[idx] = user;
  else users.push(user);
  writeJson(usersDbPath, users);
}

// === START (va qolgan barcha handlerlar) ===
// ... Sizning eski handlerlaringiz o'zgarishsiz qoladi ...
bot.start(ctx => {
    const name = ctx.from.first_name || 'foydalanuvchi';
    ctx.reply(
      `Salom, ${name}!\nBu ExamAutoBot 🤖.\nQuyidagi tugmalar orqali ishni boshlang.`,
      Markup.inlineKeyboard([
        [Markup.button.callback('📝 Ro‘yxatdan o‘tish', 'REGISTER')],
        [Markup.button.callback('🎮 Testni boshlash', 'PLAY')],
        [Markup.button.callback('⚙️ Admin kirish', 'ADMIN_LOGIN')]
      ])
    );
});
// /register va REGISTER action
const handleRegister = (ctx) => {
    const id = ctx.from.id;
    const user = findUser(id);
    if (user) {
        if (ctx.callbackQuery) ctx.answerCbQuery('✅ Siz allaqachon ro‘yxatdan o‘tgansiz.');
        return ctx.reply(`✅ ${user.name}, siz allaqachon ro‘yxatdan o‘tgansiz.`);
    }
    
    userState[id] = { mode: 'register', awaitingName: true };
    if (ctx.callbackQuery) ctx.answerCbQuery();
    ctx.reply('Ismingizni kiriting:');
};
bot.command('register', handleRegister);
bot.action('REGISTER', handleRegister);

// /admin va ADMIN_LOGIN action
const handleAdminLogin = (ctx) => {
    userState[ctx.from.id] = { mode: 'admin_login', awaitingAdminId: true };
    if (ctx.callbackQuery) ctx.answerCbQuery();
    ctx.reply('Admin ID ni kiriting:');
}
bot.command('admin', handleAdminLogin);
bot.action('ADMIN_LOGIN', handleAdminLogin);

// ADMIN MENYU TUGMASI
bot.action('ADMIN_MENU', ctx => {
    if (ctx.from.id !== ADMIN_ID) {
        ctx.answerCbQuery('❌ Faqat admin uchun.');
        return ctx.reply('❌ Faqat admin uchun.');
    }
    ctx.answerCbQuery();
    ctx.reply(
        '✅ Admin menyu:',
        Markup.inlineKeyboard([
          [Markup.button.callback('➕ Savol (Fayl/Text) qo‘shish', 'ADD_QUESTION_MENU')],
          [Markup.button.callback('👥 Foydalanuvchilar', 'SHOW_USERS')],
          [Markup.button.callback('📋 Javoblar', 'SHOW_ANSWERS')],
          [Markup.button.callback('🗑 Savollarni tozalash', 'CLEAR_QUESTIONS')]
        ])
    );
});

// Barcha text xabarlar (bitta handler)
bot.on('text', async ctx => {
  const id = ctx.from.id;
  const state = userState[id];

  // 1. Admin ID tekshiruvi (Login jarayoni)
  if (state?.mode === 'admin_login' && state?.awaitingAdminId) {
    const inputId = Number(ctx.message.text.trim());
    delete userState[id]; 
    
    if (inputId === ADMIN_ID) {
      return ctx.reply(
        '✅ Admin sifatida tizimga kirdingiz!',
        Markup.inlineKeyboard([
          [Markup.button.callback('➕ Savol (Fayl/Text) qo‘shish', 'ADD_QUESTION_MENU')],
          [Markup.button.callback('👥 Foydalanuvchilar', 'SHOW_USERS')],
          [Markup.button.callback('📋 Javoblar', 'SHOW_ANSWERS')],
          [Markup.button.callback('🗑 Savollarni tozalash', 'CLEAR_QUESTIONS')]
        ])
      );
    } else {
      return ctx.reply('❌ ID noto‘g‘ri! Faqat admin kira oladi.');
    }
  }
  
  // 2. Admin tomonidan MATNLI savollarni kiritish holati
  if (id === ADMIN_ID && state?.awaitingQuestionsText) {
      const text = ctx.message.text;
      
      try {
          const questions = extractQuestions(text); 
          
          if (!questions || questions.length === 0) {
              return ctx.reply('⚠️ Matn tahlil qilinmadi. Savollar `1. Savol`, `2. Savol` formatida ekanligiga ishonch hosil qiling yoki boshqa formatda kiritish uchun /cancel ni bosing.');
          }
          
          writeJson(questionsPath, { questions });
          delete userState[id];
          return ctx.reply(`✅ **${questions.length}** ta savol matn orqali saqlandi!`, Markup.inlineKeyboard([[Markup.button.callback('⚙️ Admin menyu', 'ADMIN_MENU')]]));
          
      } catch (e) {
          console.error("Matnli savollarni saqlashda xato:", e);
          delete userState[id];
          return ctx.reply('❌ Matnni tahlil qilishda kutilmagan xato yuz berdi. /cancel ni bosing.');
      }
  }


  // 3. Ro‘yxatdan o‘tish jarayoni
  if (state?.mode === 'register' && state?.awaitingName) {
    const name = ctx.message.text.trim();
    if (name.length < 2) return ctx.reply("Ismingiz juda qisqa, to'liq yozing.");
    
    saveUser({ id, name, username: ctx.from.username });
    delete userState[id];
    return ctx.reply(`✅ ${name}, siz ro‘yxatdan o‘tdingiz! Endi /play buyrug‘ini bering.`);
  }

  // 4. Javob berish jarayoni
  if (state?.mode === 'answering' && state?.awaitingAnswer) {
    const answer = ctx.message.text.trim();
    const user = findUser(id);
    
    if (!state.questions || state.current === undefined) {
        return ctx.reply("❌ Xatolik: Test holati aniqlanmadi. Iltimos, /play buyrug'ini qayta bering.");
    }

    const question = state.questions[state.current];
    
    // Javobni DB ga saqlash
    const answers = readJson(answersDbPath);
    answers.push({
      userId: id,
      name: user ? user.name : 'Noma\'lum',
      question,
      answer,
      timestamp: new Date().toISOString()
    });
    writeJson(answersDbPath, answers);

    // Admin'ga xabar berish
    if (ADMIN_ID) {
      bot.telegram.sendMessage(
        ADMIN_ID,
        `📩 Yangi javob:\n👤 ${ctx.from.first_name} (@${ctx.from.username || 'n/a'})\n❓ Savol: ${question}\n💬 Javob: ${answer}`
      ).catch(e => console.error("Admin'ga xabar yuborishda xato:", e.message));
    }

    // AwaitingAnswer holatini o'chirish
    delete state.awaitingAnswer; 

    // ✅ MUHIM: Javob qabul qilinganini aytish va Keyingi savol tugmasini yuborish
    await ctx.reply(
        '✅ Javobingiz qabul qilindi.',
        Markup.inlineKeyboard([Markup.button.callback('➡️ Keyingi savolga o‘tish', 'NEXT_QUESTION')])
    );
    
    // Javob berish mantiqi tugagani uchun return qilamiz
    return; 
  }
  
  // 5. Noto'g'ri matn yuborishni oldini olish (TUZATILGAN QISM)
  // Foydalanuvchi javob berishi kerak bo'lmagan, lekin keyingi savolni kutayotgan holat
  if (state?.mode === 'answering' && state?.current !== undefined && !state?.awaitingAnswer) {
      // Eslatma xabari bilan birga, 'Keyingi savolga o'tish' tugmasini QAYTA yuborish
      return ctx.reply(
          "⚠️ Iltimos, pastdagi '➡️ Keyingi savolga o‘tish' tugmasini bosing.",
          Markup.inlineKeyboard([Markup.button.callback('➡️ Keyingi savolga o‘tish', 'NEXT_QUESTION')])
      );
  }
});


// ADMIN SAVOL QO'SHISH MENYUSI va Fayl handlerlari
bot.action('ADD_QUESTION_MENU', ctx => {
    if (ctx.from.id !== ADMIN_ID) {
        ctx.answerCbQuery('❌ Faqat admin savol qo‘sha oladi.');
        return ctx.reply('❌ Faqat admin savol qo‘sha oladi.');
    }
    ctx.answerCbQuery();
    
    ctx.reply(
        'Savollarni qanday qo‘shish usulini tanlang:',
        Markup.inlineKeyboard([
            [Markup.button.callback('📄 Fayl (PDF/Rasm) orqali', 'ADD_FILE_QUESTIONS')],
            [Markup.button.callback('📝 Matn (Text) orqali', 'ADD_TEXT_QUESTIONS')],
            [Markup.button.callback('🔙 Admin Menyu', 'ADMIN_MENU')]
        ])
    );
});

bot.action('ADD_FILE_QUESTIONS', ctx => {
    if (ctx.from.id !== ADMIN_ID) return;
    ctx.answerCbQuery();
    if (userState[ctx.from.id]) delete userState[ctx.from.id].awaitingQuestionsText;
    
    ctx.reply('📎 Savollar joylashgan PDF, rasm (.jpg, .png) yoki .txt faylni yuklang.');
});

bot.action('ADD_TEXT_QUESTIONS', ctx => {
    if (ctx.from.id !== ADMIN_ID) return;
    ctx.answerCbQuery();
    
    userState[ctx.from.id] = { awaitingQuestionsText: true };
    
    ctx.reply('Savollarni matn shaklida kiriting. Har bir savol yangi qatorda va raqamlangan bo‘lishi kerak (Masalan: `1. Savol 1\\n2. Savol 2`).');
});

bot.on(['document', 'photo'], async ctx => {
  if (ctx.from.id !== ADMIN_ID) {
    return ctx.reply('❌ Faqat admin fayl yuklashi mumkin.');
  }
  
  let fileInfo;
  
  if (ctx.message.document) {
    fileInfo = ctx.message.document;
  } else if (ctx.message.photo) {
    fileInfo = ctx.message.photo.pop(); 
  } else {
    return;
  }
  
  const fileName = fileInfo.file_name || `${fileInfo.file_unique_id}.jpg`;
  const fileExt = path.extname(fileName).toLowerCase(); 

  await ctx.reply(`⏳ ${fileExt.toUpperCase()} fayli yuklanmoqda va tahlil qilinmoqda...`);

  try {
    const file = await ctx.telegram.getFile(fileInfo.file_id);
    const fileUrl = `https://api.telegram.org/file/bot${BOT_TOKEN}/${file.file_path}`;
    
    let text;
    
    if (fileExt === '.txt') {
        const response = await axios.get(fileUrl);
        text = response.data;
        
    } else {
        const { text: ocrText } = await processFileFromUrl(fileUrl, fileName); 
        text = ocrText;
    }
    
    const questions = extractQuestions(text);
    
    if (!questions || questions.length === 0) {
         return ctx.reply('⚠️ Fayl tahlil qilinmadi yoki savollar topilmadi. Savollar raqamlangan (Masalan: `1. Savol`) ekanligiga ishonch hosil qiling.');
    }
    
    writeJson(questionsPath, { questions });
    if (userState[ADMIN_ID]) delete userState[ADMIN_ID].awaitingQuestionsText;

    ctx.reply(`✅ **${questions.length}** ta savol fayl orqali saqlandi.`, Markup.inlineKeyboard([[Markup.button.callback('⚙️ Admin menyu', 'ADMIN_MENU')]]));
    
  } catch (err) {
    console.error("Fayl tahlilida xato:", err);
    ctx.reply('❌ Xatolik: Faylni tahlil qilib bo‘lmadi. ' + (err.message || ''));
  }
});


// ADMIN LIST ACTIONS
bot.action('SHOW_USERS', ctx => {
  if (ctx.from.id !== ADMIN_ID) {
    ctx.answerCbQuery('❌ Faqat admin uchun.');
    return ctx.reply('❌ Faqat admin uchun.');
  }
  ctx.answerCbQuery();
  const users = readJson(usersDbPath);
  if (!users.length) return ctx.reply('👥 Foydalanuvchilar yo‘q.');
  const list = users.map(u => `🆔 ${u.id} — ${u.name} (@${u.username || 'n/a'})`).join('\n');
  ctx.reply(list);
});

bot.action('SHOW_ANSWERS', ctx => {
  if (ctx.from.id !== ADMIN_ID) {
    ctx.answerCbQuery('❌ Faqat admin uchun.');
    return ctx.reply('❌ Faqat admin uchun.');
  }
  ctx.answerCbQuery();
  const answers = readJson(answersDbPath);
  if (!answers.length) return ctx.reply('📋 Javoblar yo‘q.');
  
  const preview = answers
    .slice(-20) 
    .map(a => `👤 ${a.name}\n❓ ${a.question}\n💬 ${a.answer}`)
    .join('\n\n--- o --- \n\n');
    
  ctx.reply(`**📋 Oxirgi 20 ta javob:**\n\n${preview}`, { parse_mode: 'Markdown' });
});

bot.action('CLEAR_QUESTIONS', ctx => {
  if (ctx.from.id !== ADMIN_ID) {
    ctx.answerCbQuery('❌ Faqat admin uchun.');
    return ctx.reply('❌ Faqat admin uchun.');
  }
  ctx.answerCbQuery();
  writeJson(questionsPath, { questions: [] });
  ctx.reply('🗑 Barcha savollar tozalandi.');
});


// KEYINGI SAVOLGA O'TISH FUNKSIYASI
bot.action('NEXT_QUESTION', ctx => {
    const id = ctx.from.id;
    const state = userState[id];

    if (!state || state.mode !== 'answering' || !state.questions) {
        return ctx.reply('❌ Test holati buzilgan. Iltimos, /play buyrug‘ini qayta bering.');
    }

    ctx.answerCbQuery('Keyingi savolga o‘tildi...');

    state.current++; // Savol indeksini oshirish

    if (state.current >= state.questions.length) {
        delete userState[id]; // Test tugadi
        return ctx.reply('🎉 Barcha savollarga javob berdingiz!');
    }

    // Keyingi savolni yuborish
    const nextQ = state.questions[state.current];
    ctx.reply(
        `❓ ${nextQ}`,
        Markup.inlineKeyboard([Markup.button.callback('✍️ Javob berish', `ANSWER_${id}`)])
    );
});


// /play va PLAY action
const handlePlay = (ctx) => {
    const id = ctx.from.id;
    const user = findUser(id);
    
    if (!user) {
        if (ctx.callbackQuery) ctx.answerCbQuery('❌ Avval ro‘yxatdan o‘ting.');
        return ctx.reply('❌ Avval /register buyrug‘ini bajaring.');
    }

    const data = readJson(questionsPath);
    const questions = data.questions || [];
    
    if (!questions.length) {
        if (ctx.callbackQuery) ctx.answerCbQuery('🚫 Savollar mavjud emas.');
        return ctx.reply('🚫 Savollar mavjud emas. Admin joylashini kuting.');
    }

    // Holatni o'rnatish
    userState[id] = { mode: 'answering', questions, current: 0 }; 
    
    if (ctx.callbackQuery) ctx.answerCbQuery();
    ctx.reply(
        `🧾 Test boshlandi. Savollar soni: **${questions.length}**\n\n❓ ${questions[0]}`,
        Markup.inlineKeyboard([Markup.button.callback('✍️ Javob berish', `ANSWER_${id}`)])
    );
}
bot.command('play', handlePlay);
bot.action('PLAY', handlePlay);

// Javob berish uchun inline tugma
bot.action(/ANSWER_(.+)/, ctx => {
  const id = Number(ctx.match[1]);
  const state = userState[id]; 
  
  if (ctx.from.id !== id) {
    return ctx.answerCbQuery("Bu tugma siz uchun emas!");
  }
  
  if (!state || state.mode !== 'answering' || state.current === undefined) {
    ctx.answerCbQuery("🚫 Avval /play buyrug'ini bering!");
    return ctx.reply("🚫 Avval /play buyrug'ini bering. Tugma yaroqsiz.");
  }
  
  // Javob kiritishni kutayotgan holatni o'rnatish
  userState[id].awaitingAnswer = true; 

  ctx.answerCbQuery('✍️ Javobingizni yozing...'); 
  // Foydalanuvchiga matn yuborishni kutayotganimizni aytish
  ctx.reply('✍️ Javobingizni yozing:');
});


// =========================================================================
// !!! WEBHOOK UCHUN O'ZGARTIRILGAN ISHGA TUSHIRISH QISMI !!!
// =========================================================================
bot.catch((err, ctx) => {
    console.error(`Opps, kutilmagan xato [${ctx.updateType}]:`, err);
});

const startWebhook = async () => {
    // 1. Portni muhit o'zgaruvchisidan olish
    // Render doimiy ravishda PORT o'zgaruvchisini o'rnatadi. 
    const PORT = process.env.PORT || 3000; 

    // 2. Render External Hostname'ni olish
    // Render platformasi Web Service uchun bu o'zgaruvchini ta'minlaydi.
    const HOSTNAME = process.env.RENDER_EXTERNAL_HOSTNAME;

    if (!HOSTNAME) {
        console.error("❌ RENDER_EXTERNAL_HOSTNAME topilmadi! Render Web Service'da joylashtirilganiga ishonch hosil qiling.");
        // Agar Render bo'lmasa, Long Pollingda ishga tushirishga harakat qilamiz (Ehtiyot chorasi)
        console.log("⚠️ Webhook o'rnatilmadi. Long Polling rejimida boshlanmoqda...");
        return bot.launch();
    }
    
    const WEBHOOK_URL = `https://${HOSTNAME}/webhook`;

    try {
        // 3. Telegramga Webhookni o'rnatish
        await bot.telegram.setWebhook(WEBHOOK_URL);
        console.log(`✅ Webhook o'rnatildi: ${WEBHOOK_URL}`);
        
        // 4. Serverni ishga tushirish (Telegraf Webhook serveri)
        await bot.startWebhook('/webhook', null, PORT);
        console.log(`✅ Bot serveri ishga tushdi va ${PORT} portida tinglamoqda.`);

    } catch (e) {
        console.error("❌ Bot ishga tushishida xato:", e.message);
        // Xato yuz bersa, ishni to'xtatish
        process.exit(1); 
    }
};

// Webhook jarayonini ishga tushirish
startWebhook();