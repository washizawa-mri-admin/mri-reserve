const express = require("express");
const { createClient } = require('@supabase/supabase-js');
const basicAuth = require("express-basic-auth");
const app = express();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

app.use(basicAuth({ users: { 'admin': 'mri1234' }, challenge: true, realm: 'MRI System' }));
app.use(express.json());
app.use(express.static("public"));

async function ensureSlotsExist(date) {
  const { data: existing } = await supabase.from('slots').select('id').eq('date', date).limit(1);
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
  const { data } = await supabase.from('slots').select('*').eq('date', date).order('time', { ascending: true });
  res.json(data || []);
});

app.post("/api/add", async (req, res) => {
  const { date } = req.body;
  const { data: latest } = await supabase.from('slots').select('time').eq('date', date).order('time', { ascending: false }).limit(1);
  let [h, m] = (latest && latest.length > 0 ? latest[0].time : "18:00").split(":").map(Number);
  m += 15; if(m >= 60){ h++; m -= 60; }
  const newTime = `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
  await supabase.from('slots').insert([{ date, time: newTime, is_extra: 1, status: "" }]);
  res.json({ status: "ok" });
});

// ★★★ 全ページ共通の更新窓口（1つに集約しました） ★★★
app.post("/api/update", async (req, res) => {
  const { id, status, doctor, patient_name, patient_id, part, is_remote } = req.body;
  
  let updateData = {};
  if (doctor !== undefined) updateData.doctor = doctor;
  if (status !== undefined) updateData.status = status;
  if (patient_name !== undefined) updateData.patient_name = patient_name;
  if (patient_id !== undefined) updateData.patient_id = patient_id;
  if (part !== undefined) updateData.part = part;
  if (is_remote !== undefined) updateData.is_remote = is_remote; // 読影フラグも保存可能に
  
  const { error } = await supabase.from('slots').update(updateData).eq('id', id);
  if (error) return res.status(500).json(error);
  res.json({ status: "ok" });
});

// フロントからの「読影」ボタン専用の窓口（念のため残しておくと確実です）
app.post("/api/remote", async (req, res) => {
  const { id, patient_name, patient_id } = req.body;
  const { error } = await supabase.from('slots').update({ 
    is_remote: 1, 
    patient_name: patient_name || null,
    patient_id: patient_id || null
  }).eq('id', id);
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
    patient_id: null,
    patient_name: null,
    part: null,
    status: "",
    doctor: null,
    is_remote: 0,
    start_time: null
  }).eq('id', req.body.id);
  res.json({ status: "ok" });
});

app.get("/api/report/all", async (req, res) => {
    const { data } = await supabase.from('slots').select('*').eq('status', 'done');
    res.json((data || []).map(r => ({ date: r.date, doctor: r.doctor || "未選択", is_remote: r.is_remote ? 1 : 0, count: (r.is_extra > 1) ? r.is_extra : 1 })));
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
