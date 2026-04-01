
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

const data = [
{ d: "2025-04-01", dr: "過去合計", c: 356 }, { d: "2025-05-01", dr: "過去合計", c: 352 },
{ d: "2025-06-01", dr: "過去合計", c: 301 }, { d: "2025-07-01", dr: "過去合計", c: 250 },
{ d: "2025-08-01", dr: "過去合計", c: 280 }, { d: "2025-09-01", dr: "過去合計", c: 303 },
{ d: "2025-10-01", dr: "過去合計", c: 324 }, { d: "2025-11-01", dr: "過去合計", c: 304 },
{ d: "2025-12-01", dr: "過去合計", c: 319 },
{ d: "2026-01-01", dr: "鷲澤", c: 152 }, { d: "2026-01-01", dr: "永野", c: 82 },
{ d: "2026-01-01", dr: "鷲澤匠", c: 26 }, { d: "2026-01-01", dr: "中村", c: 13 },
{ d: "2026-01-01", dr: "石橋", c: 15 }, { d: "2026-01-01", dr: "木内", c: 25 },
{ d: "2026-01-01", dr: "白石", c: 1 }, { d: "2026-01-01", dr: "小谷野", c: 2 },
{ d: "2026-01-01", dr: "鈴木", c: 5 },
{ d: "2026-02-01", dr: "鷲澤", c: 163 }, { d: "2026-02-01", dr: "永野", c: 61 },
{ d: "2026-02-01", dr: "鷲澤匠", c: 35 }, { d: "2026-02-01", dr: "中村", c: 13 },
{ d: "2026-02-01", dr: "石橋", c: 14 }, { d: "2026-02-01", dr: "木内", c: 24 },
{ d: "2026-02-01", dr: "白石", c: 2 }, { d: "2026-02-01", dr: "小谷野", c: 1 },
{ d: "2026-02-01", dr: "鈴木", c: 2 }
];

async function run() {
console.log("データベースのリセットと1月・2月詳細データの注入を開始します...");
await supabase.from('slots').delete().neq('id', 0);
for (const item of data) {
await supabase.from('slots').insert([
{ date: item.d, time: '00:00', status: 'done', doctor: item.dr, is_extra: item.c }
]);
}
console.log("✅ 復旧完了しました！");
}
run();
