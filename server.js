const express = require("express");
const { createClient } = require('@supabase/supabase-js');
const basicAuth = require("express-basic-auth");
const app = express();

const SUPABASE_URL = "https://pjsahgywykeevrkwzwqw.supabase.co";
const SUPABASE_KEY = "sb_secret_xPQ6kylsXER-mXqgI1JyNA_Ld_aTieg";
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

app.use(basicAuth({ users: { 'admin': 'mri1234' }, challenge: true, realm: 'MRI System' }));
app.use(express.json());
app.use(express.static("public"));

// --- 予約枠生成（ダブり防止強化） ---
async function ensureSlotsExist(date) {
  const { data: existing } = await supabase.from('slots').select('id').eq('date', date).limit(1);
  if (existing && existing.length > 0) return; // 1件でもあれば作成しない

  const d = new Date(date);
  const day = d.getDay();
  let times = ["09:00","09:30","10:00","10:30","11:00","11:30","12:00"];
  if (day === 6) { times = times.concat(["14:30", "15:00"]); } 
  else { times = times.concat(["15:00","15:30","16:00","16:30","17:00","17:30","18:00"]); }
  
  const inserts = times.map(t => ({ date, time: t, is_extra: 0, status: "" }));
  await supabase.from('slots').insert(inserts);
}

// --- API ---
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

app.post("/api/update", async (req, res) => {
  const { id, status, doctor, patient_name } = req.body;
  let updateData = { doctor };
  if (status !== undefined) updateData.status = status;
  if (patient_name !== undefined) updateData.patient_name = patient_name;
  await supabase.from('slots').update(updateData).eq('id', id);
  res.json({ status: "ok" });
});

app.post("/api/start", async (req, res) => {
  const now = new Date().toLocaleTimeString("ja-JP", { hour: '2-digit', minute: '2-digit' });
  await supabase.from('slots').update({ status: 'scanning', start_time: now, patient_name: req.body.patient_name || null }).eq('id', req.body.id);
  res.json({ status: "ok" });
});

app.post("/api/finish", async (req, res) => { await supabase.from('slots').update({ status: 'done' }).eq('id', req.body.id); res.json({ status: "ok" }); });
app.post("/api/remote", async (req, res) => { await supabase.from('slots').update({ is_remote: 1, patient_id: req.body.patient_id, patient_name: req.body.patient_name, status: 'waiting' }).eq('id', req.body.id); res.json({ status: "ok" }); });
app.post("/api/delete", async (req, res) => { await supabase.from('slots').delete().eq('id', req.body.id); res.json({ status: "ok" }); });

app.get("/api/report/all", async (req, res) => {
    const { data } = await supabase.from('slots').select('*').eq('status', 'done');
    const formatted = (data || []).map(r => ({ date: r.date, doctor: r.doctor || "未選択", is_remote: r.is_remote ? 1 : 0, count: 1 }));
    res.json(formatted);
});

app.listen(3000, "0.0.0.0", () => { console.log("MRIシステム完全版  起動中"); });