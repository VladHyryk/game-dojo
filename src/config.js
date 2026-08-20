// Єдине місце, де щось треба вставити руками.
// Обидва значення публічні — вони летять у браузер кожного гравця.
// Захист бази роблять RLS-політики (schema.sql), а не секретність ключа.
// sb_secret_* сюди НЕ клади ніколи.

export const SUPABASE_URL = 'https://syhhamuvbkisaedmqzdfa.supabase.co';
export const SUPABASE_PUBLISHABLE_KEY = 'hsb_publishable_MgiS3rEYZVXqD0MSPhIYtg_Vf4WdaNm';

export const GAME = {
  width: 960,
  height: 540,
  tile: 32,
};
