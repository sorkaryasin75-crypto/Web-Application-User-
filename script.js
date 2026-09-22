const { chromium } = require('playwright');
const UserAgent = require('user-agents');
const { faker } = require('@faker-js/faker');

// এনভায়রনমেন্ট ভেরিয়েবল (Railway Environment Variables থেকে রিড করবে)
const TARGET_URL = process.env.TARGET_URL || 'https://moneyloop24.blogspot.com/?m=1';
const TOTAL_REGISTRATIONS = parseInt(process.env.REG_COUNT || '10', 10);

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// কেবল সফল রেজিস্ট্রেশনের নোটিফিকেশন পাঠানোর ফাংশন
async function sendTelegramNotification(text) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) return;
  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text: text, parse_mode: 'HTML' })
    });
  } catch (err) {
    console.error('Telegram Notification Error:', err.message);
  }
}

// ইউনিক টেলিগ্রাম ইউজার ডাটা জেনারেটর
function generateTelegramUserData() {
  const telegramId = Math.floor(100000000 + Math.random() * 900000000);
  const firstName = faker.person.firstName();
  const lastName = faker.person.lastName();
  const username = faker.internet.userName({ firstName, lastName }).toLowerCase().replace(/[^a-z0-9_]/g, '');

  const userObj = {
    id: telegramId,
    first_name: firstName,
    last_name: lastName,
    username: username,
    language_code: "en",
    allows_write_to_pm: true
  };

  const userJson = encodeURIComponent(JSON.stringify(userObj));
  const initData = `user=${userJson}&auth_date=${Math.floor(Date.now() / 1000)}&hash=c1a32b6e7f8d90e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5`;

  return { initData, userObj, telegramId, username, fullName: `${firstName} ${lastName}` };
}

// শতভাগ সফল না হওয়া পর্যন্ত একক সেশন রান করার ফাংশন
async function executeGuaranteedRegistration(index) {
  let isCompleted = false;
  let attempt = 1;
  let tgUser = null;

  while (!isCompleted) {
    tgUser = generateTelegramUserData();
    const userAgent = new UserAgent({ deviceCategory: 'mobile' }).toString();

    // Railway এর জন্য মেমোরি অপটিমাইজড ব্রাউজার ফ্ল্যাগ
    const browser = await chromium.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--disable-gpu'
      ]
    });

    const context = await browser.newContext({
      userAgent: userAgent,
      viewport: { width: 360, height: 740 },
      locale: 'en-US'
    });

    const page = await context.newPage();

    // সকল প্রকার টাইমআউট নিষ্ক্রিয় করা হলো (নেটওয়ার্ক যত ধীরই হোক না কেন)
    page.setDefaultTimeout(0);
    page.setDefaultNavigationTimeout(0);

    try {
      console.log(`[${index + 1}/${TOTAL_REGISTRATIONS}] সেশন শুরু (চেষ্টা #${attempt}): ${tgUser.fullName} (@${tgUser.username})`);

      // ১. টেলিগ্রাম উইন্ডো অবজেক্ট ইনজেকশন
      await page.addInitScript((tgData) => {
        window.Telegram = {
          WebApp: {
            initData: tgData.initData,
            initDataUnsafe: { user: tgData.userObj },
            version: "6.0",
            platform: "android",
            ready: () => {},
            expand: () => {},
            close: () => {}
          }
        };
      }, { initData: tgUser.initData, userObj: tgUser.userObj });

      // ২. পেজে প্রবেশ (টাইমআউট ছাড়া)
      await page.goto(TARGET_URL, { waitUntil: 'commit', timeout: 0 });

      // ৩. সাইটের লোকাল এনভায়রনমেন্টে হ্যাশ ডাটা বসানো
      await page.evaluate((tgData) => {
        window.location.hash = `#tgWebAppData=${encodeURIComponent(tgData.initData)}&tgWebAppVersion=6.0&tgWebAppPlatform=android`;
        window.dispatchEvent(new Event('hashchange'));
      }, { initData: tgUser.initData });

      // ৪. সাইটের ব্যাকএন্ড রেজিস্ট্রেশন সম্পন্ন করে অ্যাকাউন্ট আইডি বা সেশন লোড করা পর্যন্ত অপেক্ষা
      await page.waitForFunction(() => {
        const bodyText = document.body ? document.body.innerText : '';
        return bodyText.includes('ACCOUNT ID') || bodyText.includes('Accepted Sales') || !!document.querySelector('.account-id');
      }, { timeout: 0 });

      // ৫. নিশ্চিত সফল হলে লুপ শেষ হবে
      isCompleted = true;
      console.log(`✔ [${index + 1}/${TOTAL_REGISTRATIONS}] সফলভাবে সম্পন্ন হয়েছে: @${tgUser.username}`);

    } catch (err) {
      attempt++;
      console.log(`⚠️ সংযোগের সমস্যার কারণে পুনরায় চেষ্টা করা হচ্ছে (Attempt ${attempt})...`);
      await delay(3000); // পুনরায় চেষ্টার আগে ৩ সেকেন্ড বিরতি
    } finally {
      await context.close();
      await browser.close();
    }
  }

  return tgUser;
}

async function main() {
  console.log('🚀 Railway Automation Engine Started...');

  await sendTelegramNotification(
    `🚀 <b>Railway সার্ভার অটোমেশন শুরু হয়েছে</b>\n\n<b>টার্গেট:</b> ${TARGET_URL}\n<b>মোট রেজিস্ট্রেশন লক্ষ্যমাত্রা:</b> ${TOTAL_REGISTRATIONS} টি`
  );

  let totalSuccessful = 0;

  for (let i = 0; i < TOTAL_REGISTRATIONS; i++) {
    const registeredUser = await executeGuaranteedRegistration(i);
    totalSuccessful++;

    // প্রতিটি কাজের পর ২ সেকেন্ড বিরতি
    await delay(2000);
  }

  // সব কাজ সফলভাবে শেষ হওয়ার পর চূড়ান্ত একটি বার্তা
  await sendTelegramNotification(
    `✅ <b>অটোমেশন কাজ সফলভাবে সম্পন্ন হয়েছে!</b>\n\n<b>মোট সফল রেজিস্ট্রেশন:</b> ${totalSuccessful} টি`
  );

  console.log('🎉 সকল রেজিস্ট্রেশন সফলভাবে সম্পন্ন হয়েছে।');
}

main();
