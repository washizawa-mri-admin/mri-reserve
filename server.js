const express = require("express");
const { createClient } = require('@supabase/supabase-js');
const basicAuth = require("express-basic-auth");
const app = express();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

app.use(express.json());
app.use(express.static("public"));

// ==========================================
// 🛡️ 門番：IPチェック処理
// ==========================================
app.use(async (req, res, next) => {
    if (req.path === '/api/update-ip') return next();

    const clientIp = req.headers['x-forwarded-for']?.split(',')[0] || req.socket.remoteAddress;

    if (clientIp.includes('::1') || clientIp.includes('127.0.0.1')) return next();

    let allowedIp = null;
    try {
        const { data } = await supabase.from('settings').select('value').eq('key', 'allowed_ip').single();
        allowedIp = data?.value;
    } catch (err) {
        console.log("Supabase通信エラー（IP変更の可能性あり）");
    }

    if (allowedIp && allowedIp.trim() !== "" && clientIp.includes(allowedIp)) {
        return next();
    }

    return res.status(403).send(`
        <div style="text-align:center; padding-top:50px; font-family:sans-serif; max-width: 600px; margin: 0 auto; line-height: 1.6;">
            <h1 style="color: #dc3545;">院内ネットワーク外からのアクセスです</h1>
            <p>このシステムはセキュリティのため、登録された院内Wi-Fiからのみ閲覧可能です。</p>
            <p>現在のあなたのIP: <b style="color:#dc3545; background:#fff5f5; padding:2px 6px; border-radius:4px;">${clientIp}</b></p>
            <hr style="border:0; border-top:1px solid #eee; margin:20px 0;">
            
            <div style="margin-top: 30px; padding: 20px; border: 1px dashed #ccc; background: #f9f9f9; border-radius: 8px;">
                <p style="font-size: 13px; color: #666; margin-bottom: 15px;">
                    <b>【管理者用】病院のルーター再起動などでIPが変わってしまった場合</b><br>
                    以下に管理用パスワードを入力してボタンを押すと、このPCのネットワークが新しい許可IPとして登録されます。
                </p>
                <input type="password" id="admin-ip-pass" placeholder="パスワードを入力" style="padding: 8px; width: 200px; border: 1px solid #ccc; border-radius: 4px; margin-right: 5px;">
                <button id="update-ip-btn" style="padding: 8px 16px; cursor: pointer; background: #007bff; color: white; border: none; border-radius: 4px; font-weight: bold;">
                    このネットを許可する
                </button>
            </div>
        </div>

        <script>
        document.getElementById('update-ip-btn').addEventListener('click', async () => {
            const password = document.getElementById('admin-ip-pass').value;
            if (password !== 'mri1234') {
                alert('パスワードが違います。');
                return;
            }
            if (!confirm('現在のネットワークを新しい院内Wi-Fiとして登録しますか？')) return;

            try {
                const res = await fetch('/api/update-ip', { method: 'POST' });
                const data = await res.json();
                if (data.success) {
                    alert('更新が完了しました！システムを再起動します。数秒後にページをリロードしてください。');
                    location.reload();
                } else {
                    alert('更新に失敗しました。');
                }
            } catch (err) {
                alert('通信エラーが発生しました。Renderの環境変数やSupabaseのキーを再確認してください。');
            }
        });
        <\/script>
    `);
});

// ==========================================
// 🚀 IP更新用API
// ==========================================
app.post('/api/update-ip', async (req, res) => {
    const newIp = req.headers['x-forwarded-for']?.split(',')[0] || req.socket.remoteAddress;
    const { error } = await supabase.from('settings').upsert({ key: 'allowed_ip', value: newIp });
    if (error) return res.status(500).json(error);
    res.json({ success: true, updatedIp: newIp });
});

// ==========================================
// 🔐 認証：Basic認証
// ==========================================
app.use(basicAuth({ users: { 'admin': 'mri1234' }, challenge: true, realm: 'MRI System' }));

// ==========================================
// 📅 カレンダー・予約システムコアロジック
// ==========================================

async function ensureSlotsExist(date) {
  const { data: existing } = await supabase.from('slots').select('id').eq('date', date).neq('time', '00:00').limit(1);
  if (existing && existing.length > 0) return;

  const d = new Date(date);
  const day = d.getDay();
  let times = ["09:00","09:30","10:00","10:30","11:00","11:30","12:00"];
  if (day === 6) { times = times.concat(["14:30", "15:00"]); }
  else if (day !== 0) { times = times.concat(["15:00","15:30","16:00","16:30","17:00","17:30","18:00"]); }
  
  const inserts = times.map(t => ({ date, time: t, is_extra: 0, status: "" }));
  await supabase.from('slots').insert(inserts);
}

app.get("/api/slots", async (req, res) => {
  const date = req.query.date;
  await ensureSlotsExist(date);
  const { data } = await supabase.from('slots').select('*').eq('date', date).neq('time', '00:00').order('time', { ascending: true });
  res.json(data || []);
});

app.post("/api/add", async (req, res) => {
  const { date } = req.body;
  const { data: latest } = await supabase.from('slots').select('time').eq('date', date).neq('time', '00:00').order('time', { ascending: false }).limit(1);
  let [h, m] = (latest && latest.length > 0 ? latest[0].time : "18:00").split(":").map(Number);
  m += 15; if(m >= 60){ h++; m -= 60; }
  const newTime = `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
  await supabase.from('slots').insert([{ date, time: newTime, is_extra: 1, status: "" }]);
  res.json({ status: "ok" });
});

app.post("/api/remote", async (req, res) => {
    const { id, patient_name, patient_id, doctor } = req.body;
    let updateData = { is_remote: 1 };
    if (patient_name !== undefined) updateData.patient_name = patient_name || null;
    if (patient_id !== undefined) updateData.patient_id = patient_id || null;
    if (doctor !== undefined && doctor !== null && doctor !== "") updateData.doctor = doctor;
    
    const { error } = await supabase.from('slots').update(updateData).eq('id', id);
    if (error) return res.status(500).json(error);
    res.json({ status: "ok" });
});

app.post("/api/start", async (req, res) => {
  const now = new Date().toLocaleTimeString("ja-JP", { hour: '2-digit', minute: '2-digit' });
  const { id, patient_name, patient_id, part } = req.body;
  await supabase.from('slots').update({ 
    status: 'scanning', 
    start_time: now, 
    patient_name: patient_name || null,
    patient_id: patient_id || null,
    part: part || null
  }).eq('id', id);
  res.json({ status: "ok" });
});

app.post("/api/delete", async (req, res) => {
  await supabase.from('slots').update({
    patient_id: null, patient_name: null, part: null, status: "", doctor: null, is_remote: 0, start_time: null
  }).eq('id', req.body.id);
  res.json({ status: "ok" });
});

// 🔄 指定年月の生データをサマリーテーブルへ集計・保存（上書き対応）
async function syncMonthlySummary(yearMonth) {
    if (!yearMonth) return;
    try {
        const { data } = await supabase
            .from('slots')
            .select('doctor, is_remote, is_extra')
            .eq('status', 'done')
            .like('date', `${yearMonth}%`);

        if (!data) return;

        const summaryMap = {};
        data.forEach(r => {
            if (!r.doctor) return;
            const isRemoteNum = (r.is_remote === 1 || r.is_remote === true || r.is_remote === "1" || r.is_remote === "true") ? 1 : 0;
            const key = `${r.doctor}_${isRemoteNum}`;
            const count = (r.is_extra && Number(r.is_extra) > 0) ? Number(r.is_extra) : 1;
            
            if (!summaryMap[key]) {
                summaryMap[key] = { year_month: yearMonth, doctor: r.doctor, is_remote: isRemoteNum, total_count: 0 };
            }
            summaryMap[key].total_count += count;
        });

        const insertRows = Object.values(summaryMap);
        await supabase.from('monthly_summary').delete().eq('year_month', yearMonth);
        if (insertRows.length > 0) {
            await supabase.from('monthly_summary').insert(insertRows);
        }
        console.log(`[確定成功] ${yearMonth} 分のデータをサマリーへ固定ロックしました。`);
    } catch (e) {
        console.error("Summary自動作成エラー:", e);
    }
}

// ==========================================
// 📊 【バグ修正版】10日境界・排他型ハイブリッド統計API
// ==========================================
app.get("/api/report/all", async (req, res) => {
    try {
        const now = new Date();
        const currentDay = now.getDate(); // 今日の日付 (1〜31)
        
        const thisMonthStr = now.toISOString().substring(0, 7); 
        const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        const lastMonthStr = lastMonth.toISOString().substring(0, 7); 
        const twoMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 2, 1);
        const twoMonthsAgoStr = twoMonthsAgo.toISOString().substring(0, 7); // 3ヶ月前（例: "2026-05"）

        let startFilter = "";

        // 💡 【10日境界のタイムシフト判定】
        if (currentDay <= 10) {
            // 📅 1日〜10日：過去3ヶ月分（今月・先月・先々月）の生データを直接読む
            startFilter = `${twoMonthsAgoStr}-01`;
        } else {
            // 📅 11日〜末日：生データの読み込みは2ヶ月分（今月・先月）に絞って軽快にする
            startFilter = `${lastMonthStr}-01`;

            // 🔥 【10日休診・連休救出】11日以降に初めて開いた時、先々月(3ヶ月前)のサマリーが無ければここで自動ロック
            const { data: checkSummary, error: checkError } = await supabase
                .from('monthly_summary')
                .select('id')
                .eq('year_month', twoMonthsAgoStr);

            // ⚠️ 判定バグを修正：checkSummaryが空配列（length === 0）の場合に確実に保存処理を動かす
            if (!checkError && (!checkSummary || checkSummary.length === 0)) {
                console.log(`[自動救出] 10日前後が休診等のため、${twoMonthsAgoStr} 分のサマリー確定処理を今実行しました。`);
                await syncMonthlySummary(twoMonthsAgoStr);
            }
        }

        const threeYearsAgo = new Date(now.getFullYear() - 3, 0, 1);
        const cutoffMonthStr = threeYearsAgo.toISOString().substring(0, 7);

        const formattedData = [];

        // 1. 過去データはサマリーテーブルから取得
        const { data: summaryData, error: summaryError } = await supabase
            .from('monthly_summary')
            .select('year_month, doctor, is_remote, total_count')
            .gte('year_month', cutoffMonthStr);

        if (summaryError) throw summaryError;

        if (summaryData) {
            summaryData.forEach(r => {
                // ⚠️ 重複を絶対に防ぐための排他除外ルール
                if (r.year_month === thisMonthStr || r.year_month === lastMonthStr) return;
                
                // 1日〜10日は「先々月」も生データで読んでいるので、サマリー側からは除外する
                if (currentDay <= 10 && r.year_month === twoMonthsAgoStr) return;

                const remoteVal = (r.is_remote === 1 || r.is_remote === true || r.is_remote === "1" || r.is_remote === "true") ? 1 : 0;
                formattedData.push({
                    date: `${r.year_month}-01`,
                    doctor: r.doctor && r.doctor.trim() !== "" ? r.doctor : "未選択",
                    is_remote: remoteVal,
                    count: Number(r.total_count)
                });
            });
        }

        // 2. リアルタイム生データ（slots）から取得してマージ
        const lastDayOfThisMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
        const endFilter = `${thisMonthStr}-${String(lastDayOfThisMonth).padStart(2, '0')}`;   

        const { data: realTimeData, error: realTimeError } = await supabase
            .from('slots')
            .select('date, doctor, is_remote, is_extra, status')
            .eq('status', 'done')
            .gte('date', startFilter)
            .lte('date', endFilter);

        if (realTimeError) throw realTimeError;

        if (realTimeData) {
            realTimeData.forEach(r => {
                const rowCount = (r.is_extra && Number(r.is_extra) > 0) ? Number(r.is_extra) : 1;
                const remoteVal = (r.is_remote === 1 || r.is_remote === true || r.is_remote === "1" || r.is_remote === "true") ? 1 : 0;
                formattedData.push({
                    date: r.date,
                    doctor: r.doctor && r.doctor.trim() !== "" ? r.doctor : "未選択",
                    is_remote: remoteVal,
                    count: rowCount
                });
            });
        }

        res.json(formattedData);

    } catch (err) {
        console.error("レポートAPIエラー:", err);
        res.status(500).json({ error: "データ取得に失敗しました" });
    }
});

app.post("/api/update", async (req, res) => {
    const { id, status, doctor, patient_name, patient_id, part, is_remote } = req.body;
    if (!id) return res.json({ status: "ignored" });

    try {
        const { data: currentSlot, error: fetchError } = await supabase.from('slots').select('status, date').eq('id', id).single();
        if (fetchError) throw fetchError;

        let updateData = {};
        if (doctor !== undefined && doctor !== null) updateData.doctor = doctor;
        if (patient_name !== undefined && patient_name !== null) updateData.patient_name = patient_name;
        if (patient_id !== undefined && patient_id !== null) updateData.patient_id = patient_id;
        if (part !== undefined && part !== null) updateData.part = part;
        if (is_remote !== undefined && is_remote !== null) updateData.is_remote = is_remote;
        
        if (currentSlot && currentSlot.status === 'done') {
            updateData.status = 'done';
        } else {
            if (status !== undefined && status !== null) updateData.status = status;
        }
        
        if (Object.keys(updateData).length === 0) return res.json({ status: "ignored" });
        
        const { error: updateError } = await supabase.from('slots').update(updateData).eq('id', id);
        if (updateError) throw updateError;
        
        // 過去のデータを手動で修正・変更した際にも不整合が出ないようサマリーを自動追従
        if (currentSlot && currentSlot.date) {
            await syncMonthlySummary(currentSlot.date.substring(0, 7));
        }
        
        res.json({ status: "ok" });
    } catch (err) {
        console.error("データ更新エラー:", err);
        return res.status(500).json({ error: "更新に失敗しました" });
    }
});

app.post('/api/reserve', async (req, res) => {
    const { id, patient_name, part, patient_id } = req.body;
    await supabase.from('slots').update({ patient_name, part, patient_id: patient_id || "", status: 'waiting' }).eq('id', id);
    res.json({ success: true });
});

app.get('/api/search', async (req, res) => {
    const { data } = await supabase.from('slots').select('*').eq('patient_id', req.query.id).order('date', { ascending: false });
    res.json(data);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0", () => { console.log(`MRI System is running on port ${PORT}`); });
