from flask import Flask, request, jsonify
from flask_cors import CORS
import random
import sqlite3
import hashlib
import smtplib
from email.message import EmailMessage

# --- 🚨 YOUR EMAIL CONFIGURATION 🚨 ---
SENDER_EMAIL = "agilesprints646@gmail.com"           # <--- PUT YOUR GMAIL HERE
SENDER_PASSWORD = "jjmfznmbaclcpykw"  # <--- PUT YOUR GOOGLE APP PASSWORD HERE (No spaces)

app = Flask(__name__)
CORS(app)

otp_store = {}

def init_db():
    conn = sqlite3.connect('auth.db')
    c = conn.cursor()
    c.execute('''CREATE TABLE IF NOT EXISTS users
                 (email TEXT PRIMARY KEY, name TEXT, password TEXT, role TEXT)''')
    conn.commit()
    conn.close()

def hash_pw(password):
    return hashlib.sha256(password.encode()).hexdigest()

def send_real_email(recipient_email, otp_code):
    """Securely transmits the OTP to the operative's actual inbox."""
    try:
        msg = EmailMessage()
        msg['Subject'] = 'Sprint Command - Security Clearance Code'
        msg['From'] = SENDER_EMAIL
        msg['To'] = recipient_email

        # The body of the email your users will receive
        msg.set_content(f"""
        ========================================
        SPRINT COMMAND CENTER: SECURITY ALERT
        ========================================
        
        An authorization request was made for this email address.
        
        Your Secure Authorization Code is: {otp_code}
        
        If you did not request this, please ignore this transmission.
        """)

        # Connect to Gmail's secure SMTP server
        with smtplib.SMTP_SSL('smtp.gmail.com', 465) as smtp:
            smtp.login(SENDER_EMAIL, SENDER_PASSWORD)
            smtp.send_message(msg)

        return True
    except Exception as e:
        print(f"\n[ERROR] Email Transmission Failed: {e}\n")
        return False

@app.route('/send-otp', methods=['POST'])
def send_otp():
    data = request.json
    email = data.get('email')

    if not email:
        return jsonify({"message": "Email designation required."}), 400

    otp = str(random.randint(100000, 999999))
    otp_store[email] = otp

    print(f" [SYSTEM] Attempting to transmit real OTP to {email}...")

    # Trigger the real email
    email_sent = send_real_email(email, otp)

    if email_sent:
        print(f" [SUCCESS] Authorization code dispatched to {email}")
        return jsonify({"message": "Authorization code dispatched."}), 200
    else:
        return jsonify({"message": "Failed to send email. Check server terminal for errors."}), 500

@app.route('/register', methods=['POST'])
def register():
    data = request.json
    email = data.get('email')
    otp = data.get('otp')

    if otp_store.get(email) != otp:
        return jsonify({"message": "Invalid or expired authorization code."}), 401

    conn = sqlite3.connect('auth.db')
    c = conn.cursor()
    try:
        c.execute("INSERT INTO users (email, name, password, role) VALUES (?, ?, ?, ?)",
                  (email, data.get('name'), hash_pw(data.get('password')), data.get('role')))
        conn.commit()
        del otp_store[email]
        return jsonify({"message": "Clearance Granted."}), 201
    except sqlite3.IntegrityError:
        return jsonify({"message": "Operative designation already exists."}), 400
    finally:
        conn.close()

@app.route('/login', methods=['POST'])
def login():
    data = request.json
    email = data.get('email')
    password = hash_pw(data.get('password'))

    conn = sqlite3.connect('auth.db')
    c = conn.cursor()
    c.execute("SELECT name, role FROM users WHERE email=? AND password=?", (email, password))
    user = c.fetchone()
    conn.close()

    if user:
        return jsonify({"name": user[0], "role": user[1]}), 200
    else:
        return jsonify({"message": "Clearance Denied. Invalid credentials."}), 401

if __name__ == '__main__':
    init_db()
    print("------------------------------------------------------------")
    print(" Python Identity Server Online | Port 5050")
    print(" LIVE EMAIL TRANSMISSION ENABLED")
    print("------------------------------------------------------------")
    app.run(port=5050, debug=True)