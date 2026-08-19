# Game Dojo — болванка

HTML5 Canvas + JS, без збірки. Supabase для лідерборду, Netlify для хостингу.

## Запустити локально

ES-модулі не працюють через `file://`, потрібен локальний сервер:

    npx serve .

Або в VS Code розширення Live Server.

## Підключити Supabase

1. Supabase → SQL Editor → вставити `schema.sql` → Run.
2. Project Settings → API Keys → скопіювати Project URL і **publishable** key.
3. Вписати обидва в `src/config.js`.

Секретний ключ (`sb_secret_*`) у фронт не потрапляє ніколи. Якщо колись знадобиться
привілейована операція — це Netlify Function, і ключ живе в env vars Netlify.

## Деплой

    git init && git add . && git commit -m "болванка"

Створити порожній репо на GitHub, запушити. Далі Netlify → Add new site →
Import an existing project → GitHub → вибрати репо. Build command порожній,
publish directory `.` — це вже прописано в `netlify.toml`, Netlify підхопить сам.

Після деплою: Site configuration → Change site name, щоб URL був людський.

## Що всередині

- `src/game.js` — цикл з фіксованим кроком 60 Гц, інпут, тайлмапа, колізії, спрайти
- `src/db.js` — читання і запис лідерборду
- `src/config.js` — єдиний файл, який треба правити
- `assets/hero.png` — спрайтшит 32×32, рядки: вниз / вліво / вправо / вгору,
  4 кадри в рядку. Поки файлу немає — гравець малюється прямокутником.

Рівень зараз генерується процедурно в `game.js`. Заміниш на свої масиви або
на генерацію кімнат в стилі Isaac.
