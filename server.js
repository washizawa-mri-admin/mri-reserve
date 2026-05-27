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

    // 判定：一致すれば通過、違っていればエラー画面（復活ボタン付き）を出す
    if (allowedIp && clientIp.includes(allowedIp)) {
        next();
    } else {
        // ➔ 締め出された時専用のエラー画面（ここにパスワード付きの復活ボタンを埋め込んであります）
        res.status(403).send(`
            <div style="text-align:center; padding-top:50px; font-family:sans-serif; max-width: 600://; margin: 0 auto; line-height: 1.6;">
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

// =
