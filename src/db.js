import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from './config.js';

const configured =
  !SUPABASE_URL.includes('ТВІЙ-ПРОЄКТ') &&
  !SUPABASE_PUBLISHABLE_KEY.includes('ВСТАВ_СЮДИ');

export const supabase = configured
  ? createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY)
  : null;

export const dbReady = configured;

// Повертає топ-10. Якщо Supabase ще не налаштований — порожній список,
// гра від цього не ламається.
export async function topScores(limit = 10) {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('scores')
    .select('player, score, created_at')
    .order('score', { ascending: false })
    .limit(limit);

  if (error) {
    console.error('Не вдалось прочитати лідерборд:', error.message);
    return [];
  }
  return data;
}

export async function submitScore(player, score) {
  if (!supabase) return { ok: false, reason: 'Supabase не налаштований' };

  const name = String(player).trim().slice(0, 24) || 'anon';
  const { error } = await supabase
    .from('scores')
    .insert({ player: name, score: Math.floor(score) });

  if (error) {
    console.error('Не вдалось записати результат:', error.message);
    return { ok: false, reason: error.message };
  }
  return { ok: true };
}
