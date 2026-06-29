const express = require("express");
const { createClient } = require('@supabase/supabase-js');
const app = express();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// 🚨 起動した瞬間に4月のデータを1000件制限を回避して強制保存する処理
(async function forceFixApril() {
    console.log("--- [🚨4月強制救出作戦スタート] ---");
    try {
        // 1000件制限を避けるため、4月1日〜15日、16日〜30日に分けて生データを取得
        const { data: part1 } = await supabase.from('slots').select('doctor, is_remote, is_extra').eq('status', 'done').gte('date', '2026-04-01').lte('date', '2026-04-15');
        const { data: part2 } = await supabase.from('slots').select('doctor, is_remote, is_extra').eq('status', 'done').gte('date', '2026-04-16').lte('date', '2026-04-30');
        
        const allAprilData = [...(part1 || []), ...(part2 || [])];
        console.log(`4月の生の撮影完了データ合計: ${allAprilData.length} 件`);

        if (allAprilData.length === 0) {
            console.log("4月の done ステータスのデータが見つかりません。");
            return;
        }

        const summaryMap = {};
        allAprilData.forEach(r => {
            if (!r.doctor) return;
            const isRemoteNum = (r.is_remote === 1 || r.is_remote === true || r.is_remote === "1" || r.is_remote === "true") ? 1 : 0;
            const key = `${r.doctor}_${isRemoteNum}`;
            const count = (r.is_extra && Number(r.is_extra) > 0) ? Number(r.is_extra) : 1;
            
            if (!summaryMap[key]) {
                summaryMap[key] = { year_month: "2026-04", doctor: r.doctor, is_remote: isRemoteNum, total_count: 0 };
            }
            summaryMap[key].total_count += count;
        });

        const upsertRows = Object.values(summaryMap);
        if (upsertRows.length > 0) {
            const { error } = await supabase.from('monthly_summary').upsert(upsertRows, { onConflict: 'year_month,doctor,is_remote' });
            if (error) {
                console.error("サマリーテーブルへの保存に失敗:", error);
            } else {
                console.log("🎉 4月のデータをサマリーテーブルに完全に保存・ロックしました！内容:", upsertRows);
            }
        }
    } catch (e) {
        console.error("予期せぬエラー:", e);
    }
    console.log("--- [🚨救出作戦終了] ---");
})();

app.get("/", (req, res) => { res.send("4月データ修復用プログラム起動中。RenderのLogsを確認してください。"); });
app.get("/api/report/all", (req, res) => { res.json([]); });

const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0", () => {});
