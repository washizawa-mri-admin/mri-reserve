const express = require("express");
const { createClient } = require('@supabase/supabase-js');
const basicAuth = require("express-basic-auth");
const app = express();

// 環境変数（Renderの管理画面で設定したURLとSecret Keyがここに入ります）
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

app.use(express.json());
app.use(express.static("public"));

// ==========================================
// 🛡️ 門番：IPチェック処理
// ==========================================
app.use(async (req, res, next) => {
    // IP更新用APIへのアクセスだけは、ブロックせずに通す（そうしないと更新ボタンが押せないため）
    if (req.path === '/api/update-ip') return next();

    const clientIp = req.headers['x-forwarded-for']?.split(',')[0] || req.socket.remoteAddress;

    // ローカル環境（自分のPCでの開発中）は常に許可
    if (clientIp.includes('::1') || clientIp.includes('127.0.0.1')) return next();

    // Supabaseのsettingsテーブルから、現在許可されているIPアドレスを取得
    const { data } = await supabase.from('settings').select('value').eq('key', 'allowed_ip').single();
    const allowedIp = data?.value;

    // 判定：許可IPがちゃんと存在して、かつ現在のIPが含まれている場合だけ通過！
    //（データが取れない、またはIPが違えば確実にelseに進んで赤い画面になります）
    if (allowedIp && allowedIp.trim() !== "" && clientIp.includes(allowedIp)) {
        next();
    } else {
        // ➔ 締め出された時専用のエラー画面（ここにパスワード付きの復活ボタンを埋め込んであります）
        res.status(403).send(`
            <div style="text-align:center; padding-top:50px; font-family:sans-serif; max-width: 600px; margin: 0 auto; line-height: 1.6;">
                <h1 style="color: #dc3545;">院内ネットワーク外からのアクセスです</h1>
                <p>このシステムはセキュリティのため、登録された院内Wi-Fiからのみ閲覧可能です。</p>
                <p>現在のあなたのIP: <b style="color:#dc3545; background:#fff5f5; padding:2px 6px; border-radius:4px;">${clientIp}</b></p>
                <hr style="border:0; border-top:1px solid #eee; margin:3px 0;">
                
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
                
                // 簡易パスワードチェック（Basic認証のパスワードと同じにしています）
                if (password !== 'mri1234') {
                    alert('パスワードが違います。');
                    return;
                }

                if (!confirm('現在のネットワークを新しい院内Wi-Fiとして登録しますか？')) return;

                try {
                    const res = await fetch('/api/update-ip', { method: 'POST' });
                    const data = await res.json();
                    
                    if (data.success) {
                        alert('更新が完了しました！現在のIP: ' + data.updatedIp);
                        location.reload(); // 画面をリロードしていつもの予約画面へ
                    } else {
                        alert('データベースの更新に失敗しました。');
                    }
                } catch (err) {
                    alert('通信エラーが発生しました。');
                }
            });
            <\/script>
        `);
    }
});

// ==========================================
// 🚀 IP更新用API（ボタンを押した時にここが動きます）
// ==========================================
app.post('/api/update-ip', async (req, res) => {
    const newIp = req.headers['x-forwarded-for']?.split(',')[0] || req.socket.remoteAddress;
    const { error } = await supabase.from('settings').upsert({ key: 'allowed_ip', value: newIp });
    if (error) return res.status(500).json(error);
    res.json({ success: true, updatedIp: newIp });
});

// ==========================================
// 🔐 認証：Basic認証（IP制限を突破した人のみパスワードを聞く）
// ==========================================
app.use(basicAuth({ users: { 'admin': 'mri1234' }, challenge: true, realm: 'MRI System' }));


// ==========================================
// 📅 以下、小野さんの元のカレンダー・予約ロジック（無改造）
// ==========================================

// スロットの自動生成
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

// 予約枠取得
app.get("/api/slots", async (req, res) => {
  const date = req.query.date;
  await ensureSlotsExist(date);
  const { data } = await supabase.from('slots').select('*').eq('date', date).order('time', { ascending: true });
  res.json(data || []);
});

// 枠の追加
app.post("/api/add", async (req, res) => {
  const { date } = req.body;
  const { data: latest } = await supabase.from('slots').select('time').eq('date', date).order('time', { ascending: false }).limit(1);
  let [h, m] = (latest && latest.length > 0 ? latest[0].time : "18:00").split(":").map(Number);
  m += 15; if(m >= 60){ h++; m -= 60; }
  const newTime = `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
  await supabase.from('slots').insert([{ date, time: newTime, is_extra: 1, status: "" }]);
  res.json({ status: "ok" });
});

// データ更新窓口
app.post("/api/update", async (req, res) => {
  const { id, status, doctor, patient_name, patient_id, part, is_remote } = req.body;
  let updateData = {};
  if (doctor !== undefined) updateData.doctor = doctor;
  if (status !== undefined) updateData.status = status;
  if (patient_name !== undefined) updateData.patient_name = patient_name;
  if (patient_id !== undefined) updateData.patient_id = patient_id;
  if (part !== undefined) updateData.part = part;
  if (is_remote !== undefined) updateData.is_remote = is_remote;
  
  const { error } = await supabase.from('slots').update(updateData).eq('id', id);
  if (error) return res.status(500).json(error);
  res.json({ status: "ok" });
});

// 読影
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

// 撮影開始
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

// 削除（リセット）
app.post("/api/delete", async (req, res) => {
  await supabase.from('slots').update({
    patient_id: null, patient_name: null, part: null, status: "", doctor: null, is_remote: 0, start_time: null
  }).eq('id', req.body.id);
  res.json({ status: "ok" });
});

// ★追加した集計API: ドクター別の撮影一覧
app.get("/api/report/doctors", async (req, res) => {
  const { data, error } = await supabase
    .from('slots')
    .select('date, doctor')
    .not('doctor', 'is', null)
    .neq('doctor', '');

  if (error) return res.status(500).json(error);

  const stats = data.reduce((acc, curr) => {
    const key = `${curr.date}_${curr.doctor}`;
    if (!acc[key]) acc[key] = { date: curr.date, doctor: curr.doctor, count: 0 };
    acc[key].count += 1;
    return acc;
  }, {});

  res.json(Object.values(stats).sort((a, b) => b.date.localeCompare(a.date)));
});

// 既存のレポートAPI
app.get("/api/report/all", async (req, res) => {
    const { data } = await supabase.from('slots').select('*').eq('status', 'done');
    res.json((data || []).map(r => ({ date: r.date, doctor: r.doctor || "未選択", is_remote: r.is_remote ? 1 : 0, count: (r.is_extra > 1) ? r.is_extra : 1 })));
});

// 予約登録
app.post('/api/reserve', async (req, res) => {
    const { id, patient_name, part, patient_id } = req.body;
    await supabase.from('slots').update({ patient_name, part, patient_id: patient_id || "", status: 'waiting' }).eq('id', id);
    res.json({ success: true });
});

// 検索
app.get('/api/search', async (req, res) => {
    const { data } = await supabase.from('slots').select('*').eq('patient_id', req.query.id).order('date', { ascending: false });
    res.json(data);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0", () => { console.log(`MRI System is running on port ${PORT}`); });
