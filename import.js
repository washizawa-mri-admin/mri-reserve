const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

const data2025 = [
  { m: "04", c: 356 }, { m: "05", c: 352 }, { m: "06", c: 301 },
  { m: "07", c: 250 }, { m: "08", c: 280 }, { m: "09", c: 303 },
  { m: "10", c: 324 }, { m: "11", c: 304 }, { m: "12", c: 319 }
];

const data2026_01_Normal = [
  { d: "鷲澤", c: 152 }, { d: "永野", c: 72 }, { d: "鷲澤匠", c: 26 },
  { d: "木内", c: 25 }, { d: "石橋", c: 15 }, { d: "白石", c: 1 },
  { d: "鈴木", c: 5 }, { d: "中村", c: 13 }, { d: "小谷野", c: 2 }
];

const data2026_01_Remote = [
  { d: "鷲澤", c: 6 }, { d: "永野", c: 64 }, { d: "鷲澤匠", c: 4 },
  { d: "木内", c: 11 }, { d: "鈴木", c: 5 }, { d: "中村", c: 4 }
];

async function runImport() {
  console.log("データ注入を開始します...");

  // 1. 2025年分
  for (const item of data2025) {
    await supabase.from('slots').insert([
      { date: `2025-${item.m}-01`, time: '00:00', status: 'done', doctor: '過去合計', is_extra: item.c, is_remote: 0 }
    ]);
  }

  // 2. 2026年1月 通常
  for (const item of data2026_01_Normal) {
    await supabase.from('slots').insert([
      { date: '2026-01-01', time: '00:00', status: 'done', doctor: item.d, is_extra: item.c, is_remote: 0 }
    ]);
  }

  // 3. 2026年1月 読影
  for (const item of data2026_01_Remote) {
    await supabase.from('slots').insert([
      { date: '2026-01-01', time: '00:00', status: 'done', doctor: item.d, is_extra: item.c, is_remote: 1 }
    ]);
  }

  console.log("✅ 全データの注入が完了しました！");
}

runImport();
