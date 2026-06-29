const express = require("express");
const { createClient } = require('@supabase/supabase-js');
const app = express();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// 🚨 ユニーク制約エラーを完全回避して4月を強制保存する使い捨て処理
(async function forceFixAprilSafe() {
    console.log("--- [🚨4月強制救出作戦・安全対策版スタート] ---");
    try {
        // 1000件制限を避けるため、4月を前・後半に分けて安全に生データを取得
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

        const insertRows = Object.values(summaryMap);
        if (insertRows.length > 0) {
            // ⭐ エラー回避策：ON CONFLICTを使わず、まず2026-04の古いサマリーデータを一度キレイに全削除
            await supabase.from('monthly_summary').delete().eq('year_month', '2026-04');
            
            // その後、新しく計算した正しいデータをまとめて挿入
            const { error } = await supabase.from('monthly_summary').insert(insertRows);
            
            if (error) {
                console.error("サマリーテーブルへの挿入に失敗:", error);
            } else {
                console.log("🎉 エラー回避成功！4月のサマリーデータを正常に新しく保存・ロックしました！", insertRows);
            }
        }
    } catch (e) {
        console.error("予期せぬエラー:", e);
    }
    console.log("--- [🚨救出作戦終了] ---");
})();

app.get("/", (req, res) => { res.send("4月データエラー修復プログラム起動中。RenderのLogsを確認してください。"); });
app.get("/api/report/all", (req, res) => { res.json([]); });

const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0", () => {});
