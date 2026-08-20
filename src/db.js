import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from './config.js';

export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
export const dbReady = true;

export async function topScores(limit = 10) {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('scores')
    .select('player, score, created_at')
    .order('score', { ascending: false })
    .limit(limit);

  if (error) {
    console.error('Помилка лідерборду:', error.message);
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
    console.error('Помилка запису очок:', error.message);
    return { ok: false, reason: error.message };
  }
  return { ok: true };
}