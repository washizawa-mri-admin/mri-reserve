const express = require("express");
const { createClient } = require('@supabase/supabase-js');
const basicAuth = require("express-basic-auth");
const app = express();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// 基本認証の設定
app.use(basicAuth({ users: { 'admin': 'mri1234' }, challenge: true, realm: 'MRI System' }));
app.use(express.json());
app.use(express.static("public"));

// --- 予約枠生成（その日の枠がない場合に自動作成） ---
async function ensureSlotsExist(date) {
  const { data: existing } = await supabase.from('slots').select('id').eq('date', date).limit(1);
  if (existing && existing.length > 0) return;

  const d = new Date(date);
  const day = d.getDay(); // 0:日, 6:土
  let times = ["09:00","09:30","10:00","10:30","11:00","11:30","12:00"];
  
  if (day === 6) { 
    // 土曜日のスケジュール
    times = times.concat(["14:30", "15:00"]); 
  } else if (day !== 0) { 
    // 平日のスケジュール（日曜以外）
    times = times.concat(["15:00","15:30","16:00","16:30","17:00","17:30","18:00"]); 
  }
  
  const inserts = times.map(t => ({ date, time: t, is_extra: 0, status: "" }));
  await supabase.from('slots').insert(inserts);
}

// --- 予約枠取得 ---
app.get("/api/slots", async (req, res) => {
  const date = req.query.date;
  if (!date) return res.status(400).json({ error: "Date is required" });
  
  await ensureSlotsExist(date);
  const { data } = await supabase.from('slots').select('*').eq('date', date).order('time', { ascending: true });
  res.json(data || []);
});

// --- 枠の追加（手動追加） ---
app.post("/api/add", async (req, res) => {
  const { date } = req.body;
  const { data: latest } = await supabase.from('slots').select('time').eq('date', date).order('time', { ascending: false }).limit(1);
  
  let [h, m] = (latest && latest.length > 0 ? latest[0].time : "18:00").split(":").map(Number);
  m += 15; if(m >= 60){ h++; m -= 60; }
  const newTime = `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
  
  await supabase.from('slots').insert([{ date, time: newTime, is_extra: 1, status: "" }]);
  res.json({ status: "ok" });
});

// --- 保存・更新（最新：部位 part を含む統合版） ---
app.post("/api/update", async (req, res) => {
  const { id, status, doctor, patient_name, patient_id, part } = req.body;
  
  let updateData = {};
  if (doctor !== undefined) updateData.doctor = doctor;
  if (status !== undefined) updateData.status = status;
  if (patient_name !== undefined) updateData.patient_name = patient_name;
  if (patient_id !== undefined) updateData.patient_id = patient_id;
  if (part !== undefined) updateData.part = part;
  
  const { error } = await supabase.from('slots').update(updateData).eq('id', id);
  
  if (error) {
    console.error("Update Error:", error);
    return res.status(500).json({ error: error.message });
  }
  res.json({ status: "ok" });
});

// --- 撮影開始 ---
app.post("/api/start", async (req, res) => {
  const now = new Date().toLocaleTimeString("ja-JP", { hour: '2-digit', minute: '2-digit' });
  const { id, patient_name, patient_id, part } = req.body;
  
  const { error } = await supabase.from('slots').update({ 
    status: 'scanning', 
    start_time: now, 
    patient_name: patient_name || null,
    patient_id: patient_id || null,
    part: part || null
  }).eq('id', id);
  
  if (error) return res.status(500).json(error);
  res.json({ status: "ok" });
});

// --- 各種ステータス変更・削除 ---
app.post("/api/finish", async (req, res) => { 
  await supabase.from('slots').update({ status: 'done' }).eq('id', req.body.id); 
  res.json({ status: "ok" }); 
});

app.post("/api/remote", async (req, res) => { 
  await supabase.from('slots').update({ 
    is_remote: 1, 
    patient_id: req.body.patient_id, 
    patient_name: req.body.patient_name, 
    status: 'waiting' 
  }).eq('id', req.body.id); 
  res.json({ status: "ok" }); 
});

app.post("/api/delete", async (req, res) => { 
  await supabase.from('slots').delete().eq('id', req.body.id); 
  res.json({ status: "ok" }); 
});

// --- レポート（実績計上）用 ---
app.get("/api/report/all", async (req, res) => {
    const { data } = await supabase.from('slots').select('*').eq('status', 'done');
    const formatted = (data || []).map(r => {
        const actualCount = (r.is_extra > 1) ? r.is_extra : 1;
        return { 
            date: r.date, 
            doctor: r.doctor || "未選択", 
            is_remote: r.is_remote ? 1 : 0, 
            count: actualCount 
        };
    });
    res.json(formatted);
});

// --- 週間予約ページからの予約実行 ---
app.post('/api/reserve', async (req, res) => {
    const { id, patient_name, part, patient_id } = req.body;
    const { error } = await supabase
        .from('slots')
        .update({ 
            patient_name, 
            part, 
            patient_id: patient_id || "", 
            status: 'waiting' 
        })
        .eq('id', id);
    if (error) return res.status(500).json(error);
    res.json({ success: true });
});

// --- ID履歴検索API ---
app.get('/api/search', async (req, res) => {
    const { id } = req.query;
    const { data, error } = await supabase
        .from('slots')
        .select('*')
        .eq('patient_id', id)
        .order('date', { ascending: false });

    if (error) {
        console.error("検索エラー:", error);
        return res.status(500).json(error);
    }
    res.json(data);
});

// --- サーバー起動 ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0", () => { 
  console.log(`MRI Reservation System is running on port ${PORT}`); 
});
