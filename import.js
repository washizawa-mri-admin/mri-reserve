const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

const recoveryData = [
{ d: "2025-04-01", c: 356 }, { d: "2025-05-01", c: 352 }, { d: "2025-06-01", c: 301 },
{ d: "2025-07-01", c: 250 }, { d: "2025-08-01", c: 280 }, { d: "2025-09-01", c: 303 },
{ d: "2025-10-01", c: 324 }, { d: "2025-11-01", c: 304 }, { d: "2025-12-01", c: 319 },
{ d: "2026-01-01", c: 306 },
{ d: "2026-02-01", c: 320 },
{ d: "2026-03-01", c: 285 }
];

async function runImport() {
console.log("データベースのリセットと注入を開始します...");
await supabase.from('slots').delete().neq('id', 0);

for (const item of recoveryData) {
await supabase.from('slots').insert([
{
date: item.d,
time: '00:00',
status: 'done',
doctor: '過去合計',
is_extra: item.c,
is_remote: 0
}
]);
}
console.log("✅ 全データの土台作りが完了しました！");
}

runImport();
