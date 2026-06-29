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
        console.log("Supabase通信エラー");
    }
    if (allowedIp && allowedIp.trim() !== "" && clientIp.includes(allowedIp)) return next();
    return res.status(403).send(`院内ネットワーク外からのアクセスです`);
});

app.post('/api/update-ip', async (req, res) => {
    const newIp = req.headers['x-forwarded-for']?.split(',')[0] || req.socket.remoteAddress;
    await supabase.from('settings').upsert({ key: 'allowed_ip', value: newIp });
    res.json({ success: true });
});

app.use(basicAuth({ users: { 'admin': 'mri1234' }, challenge: true }));

// ==========================================
// 📅 予約システムコアロジック
// ==========================================
async function ensureSlotsExist(date) {
  const { data: existing } = await supabase.from('slots').select('id').eq('date', date).neq('time', '00:00').limit(1);
  if (existing && existing.length > 0) return;
  const d = new Date(date); const day = d.getDay();
  let times = ["09:00","09:30","10:00","10:30","11:00","11:30","12:00"];
  if (day === 6) { times = times.concat(["14:30", "15:00"]); }
  else if (day !== 0) { times = times.concat(["15:00","15:30","16:00","16:30","17:00","17:30","18:00"]); }
  const inserts = times.map(t => ({ date, time: t, is_extra: 0, status: "" }));
  await supabase.from('slots').insert(inserts);
}

app.get("/api/slots", async (req, res) => {
  await ensureSlotsExist(req.query.date);
  const { data } = await supabase.from('slots').select('*').eq('date', req.query.date).neq('time', '00:00').order('time', { ascending: true });
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
    await supabase.from('slots').update({ is_remote: 1, patient_name: patient_name || null, patient_id: patient_id || null, doctor: doctor || null }).eq('id', id);
    res.json({ status: "ok" });
});

app.post("/api/start", async (req, res) => {
  const now = new Date().toLocaleTimeString("ja-JP", { hour: '2-digit', minute: '2-digit' });
  await supabase.from('slots').update({ status: 'scanning', start_time: now, patient_name: req.body.patient_name || null, patient_id: req.body.patient_id || null, part: req.body.part || null }).eq('id', req.body.id);
  res.json({ status: "ok" });
});

app.post("/api/delete", async (req, res) => {
  await supabase.from('slots').update({ patient_id: null, patient_name: null, part: null, status: "", doctor: null, is_remote: 0, start_time: null }).eq('id', req.body.id);
  res.json({ status: "ok" });
});

// 🔄 データ同期関数
async function syncMonthlySummary(dateStr) {
    if (!dateStr) return;
    const yearMonth = dateStr.substring(0, 7);
    try {
        const { data } = await supabase.from('slots').select('doctor, is_remote, is_extra').eq('status', 'done').like('date', `${yearMonth}%`);
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
        const upsertRows = Object.values(summaryMap);
        if (upsertRows.length > 0) {
            await supabase.from('monthly_summary').upsert(upsertRows, { onConflict: 'year_month,doctor,is_remote' });
        }
    } catch (e) { console.error(e); }
}

// ==========================================
// 📊 【一時的】過去3ヶ月生集計 ＆ 4月強制保存API
// ==========================================
app.get("/api/report/all", async (req, res) => {
    try {
        const now = new Date();
        // 今月(6月)、先月(5月)、先々月(4月)の文字列を生成
        const m0 = now.toISOString().substring(0, 7); // 2026-06
        const m1 = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString().substring(0, 7); // 2026-05
        const m2 = new Date(now.getFullYear(), now.getMonth() - 2, 1).toISOString().substring(0, 7); // 2026-04

        const formattedData = [];

        // 1. 3月以前のデータはサマリーから一瞬で取得
        const { data: summaryData } = await supabase.from('monthly_summary').select('year_month, doctor, is_remote, total_count');
        if (summaryData) {
            summaryData.forEach(r => {
                // 4月、5月、6月はサマリーからはじく（二重カウント防止）
                if (r.year_month === m0 || r.year_month === m1 || r.year_month === m2) return;
                const remoteVal = (r.is_remote === 1 || r.is_remote === true) ? 1 : 0;
                formattedData.push({ date: `${r.year_month}-01`, doctor: r.doctor, is_remote: remoteVal, count: Number(r.total_count) });
            });
        }

        // 2. 4月・5月・6月の3ヶ月分を slots (生データ) からリアルタイムにがっつり読み込む
        const startFilter = `${m2}-01`; // 2026-04-01
        const { data: realTimeData } = await supabase.from('slots').select('date, doctor, is_remote, is_extra').eq('status', 'done').gte('date', startFilter);

        if (realTimeData) {
            realTimeData.forEach(r => {
                const rowCount = (r.is_extra && Number(r.is_extra) > 0) ? Number(r.is_extra) : 1;
                const remoteVal = (r.is_remote === 1 || r.is_remote === true) ? 1 : 0;
                formattedData.push({ date: r.date, doctor: r.doctor || "未選択", is_remote: remoteVal, count: rowCount });
            });
        }

        // ⭐【今回の目的】APIが叩かれた瞬間、バックグラウンドで4月のデータをサマリーテーブルに強制書き込み・確定させる
        syncMonthlySummary("2026-04-01");

        res.json(formattedData);
    } catch (err) {
        res.status(500).json({ error: "エラー" });
    }
});

app.post("/api/update", async (req, res) => {
    const { id, status, doctor, patient_name, patient_id, part, is_remote } = req.body;
    if (!id) return res.json({ status: "ignored" });
    try {
        const { data: currentSlot } = await supabase.from('slots').select('status, date').eq('id', id).single();
        let updateData = { doctor, patient_name, patient_id, part, is_remote };
        if (currentSlot && currentSlot.status === 'done') { updateData.status = 'done'; } 
        else if (status !== undefined) { updateData.status = status; }
        await supabase.from('slots').update(updateData).eq('id', id);
        if (currentSlot && currentSlot.date) { await syncMonthlySummary(currentSlot.date); }
        res.json({ status: "ok" });
    } catch (err) { res.status(500).json({ error: "失敗" }); }
});

app.post('/api/reserve', async (req, res) => {
    await supabase.from('slots').update({ patient_name: req.body.patient_name, part: req.body.part, patient_id: req.body.patient_id || "", status: 'waiting' }).eq('id', req.body.id);
    res.json({ success: true });
});

app.get('/api/search', async (req, res) => {
    const { data } = await supabase.from('slots').select('*').eq('patient_id', req.query.id).order('date', { ascending: false });
    res.json(data);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0", () => {});
