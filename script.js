/* ============================================================
   GROWTH GUARDIAN AI - script.js
   Vanilla JS (ES Module)  •  Firebase Firestore/Storage + localStorage fallback
   ============================================================ */

/* ------------------------------------------------------------
   1) firebaseConfig  →  นำค่าจริงจาก Firebase Console มาวางแทน YOUR_xxx
   ------------------------------------------------------------ */
const firebaseConfig = {
  apiKey: "AIzaSyD6ariEo4995nB0m_hTE5-Vn8pA8Y8yun8",
  authDomain: "growth-guardian-ai.firebaseapp.com",
  projectId: "growth-guardian-ai",
  storageBucket: "growth-guardian-ai.firebasestorage.app",
  messagingSenderId: "684295433620",
  appId: "1:684295433620:web:9c68da807353d557163381",
  measurementId: "G-D4Z1ZLLWGM"
};

/* ------------------------------------------------------------
   2) สถานะระบบ (State) ส่วนกลาง
   ------------------------------------------------------------ */
const DB = { mode: "local", db: null, storage: null, fx: null }; // fx = ฟังก์ชัน firestore ที่ import มา
let students = [];            // รายชื่อนักเรียนทั้งหมด (cache)
let currentStudent = null;    // นักเรียนที่กำลังทำงานอยู่
let currentAgeGroup = "3";    // ช่วงอายุที่เลือก
let currentTaskScores = [];   // คะแนนภารกิจรอบปัจจุบัน
let currentPhotoFile = null;  // ไฟล์รูปที่เพิ่งเลือก
let currentPhotoData = null;  // dataURL ของรูป (ใช้ในโหมด local)
const charts = {};            // เก็บ instance ของ Chart.js เพื่อ destroy ก่อนวาดใหม่

// ชื่อ collection ใน Firestore
const COL_STUDENTS = "students";
const COL_HISTORY  = "history";   // เก็บประวัติการประเมิน (เดิมชื่อ assessments)

// ตัวยกเลิกการฟังข้อมูลแบบเรียลไทม์ (onSnapshot)
let unsubStudents = null;
let unsubHistory = null;

/* ------------------------------------------------------------
   3) ชุดภารกิจตามช่วงอายุ (category ใช้สร้างคำแนะนำ)
   ------------------------------------------------------------ */
const TASK_SETS = {
  "2": [
    { name: "แยกสีพื้นฐาน", q: 5, max: 20, icon: "🎨", cat: "color" },
    { name: "แยกรูปทรงพื้นฐาน", q: 5, max: 20, icon: "🔷", cat: "shape" },
    { name: "จับคู่ภาพเหมือน", q: 5, max: 15, icon: "🖼️", cat: "category" },
    { name: "แยกสัตว์ / อาหาร", q: 5, max: 15, icon: "🍎", cat: "category" }
  ],
  "3": [
    { name: "แยกสี 5 สี", q: 6, max: 20, icon: "🎨", cat: "color" },
    { name: "แยกรูปทรง", q: 6, max: 20, icon: "🔷", cat: "shape" },
    { name: "จำแนกตัวอักษร ก ข ค", q: 5, max: 15, icon: "🔤", cat: "letter" },
    { name: "แยกหมวดหมู่ สัตว์ / อาหาร / ของใช้", q: 5, max: 15, icon: "🍎", cat: "category" }
  ],
  "4": [
    { name: "แยกสีและเฉดสี", q: 8, max: 20, icon: "🎨", cat: "color" },
    { name: "แยกรูปทรงและขนาด", q: 8, max: 20, icon: "🔷", cat: "shape" },
    { name: "จำแนกตัวอักษรไทย", q: 6, max: 15, icon: "🔤", cat: "letter" },
    { name: "แยกหมวดหมู่ 4 กลุ่ม", q: 6, max: 15, icon: "🍎", cat: "category" }
  ],
  "5": [
    { name: "แยกสีขั้นสูง", q: 10, max: 20, icon: "🎨", cat: "color" },
    { name: "แยกรูปทรงซับซ้อน", q: 10, max: 20, icon: "🔷", cat: "shape" },
    { name: "จับคู่ตัวอักษรกับคำ", q: 8, max: 15, icon: "🔤", cat: "letter" },
    { name: "แยกหมวดหมู่พร้อมเหตุผล", q: 8, max: 15, icon: "🍎", cat: "category" }
  ]
};

/* เกณฑ์น้ำหนัก/ส่วนสูงตามอายุ (ช่วงมาตรฐาน) */
const BODY_CRITERIA = {
  "2": { weight: [11, 14.5], height: [82, 92] },
  "3": { weight: [12, 17],   height: [90, 102] },
  "4": { weight: [14, 20],   height: [97, 110] },
  "5": { weight: [16, 23],   height: [104, 118] }
};

/* ค่ากลางของเกณฑ์ ใช้เป็นเส้น "เกณฑ์มาตรฐาน" ในกราฟ */
const STD_WEIGHT = { "2": 12.5, "3": 14.5, "4": 17, "5": 19.5 };
const STD_HEIGHT = { "2": 87,   "3": 96,   "4": 103.5, "5": 111 };

const THAI_MONTHS = ["มกราคม","กุมภาพันธ์","มีนาคม","เมษายน","พฤษภาคม","มิถุนายน",
                     "กรกฎาคม","สิงหาคม","กันยายน","ตุลาคม","พฤศจิกายน","ธันวาคม"];

/* ============================================================
   ส่วนที่ 1 : ฟังก์ชันคำนวณ (Logic)
   ============================================================ */

// แปลงวันที่หลากรูปแบบ → { year, month, day } (ค.ศ. เสมอ)
// รองรับ: yyyy-mm-dd | dd/mm/yyyy | dd-mm-yyyy | dd.mm.yyyy
// ปี พ.ศ. (> 2400) แปลงเป็น ค.ศ. อัตโนมัติ
function parseBirthDate(val) {
  if (!val || typeof val !== "string") return null;
  val = val.trim().replace(/\s+/g, "");
  if (!val) return null;

  let y, m, d;

  if (/^\d{4}-\d{2}-\d{2}$/.test(val)) {
    // รูปแบบ ISO: yyyy-mm-dd
    [y, m, d] = val.split("-").map(Number);
  } else if (/^\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4}$/.test(val)) {
    // รูปแบบ dd/mm/yyyy หรือ dd-mm-yyyy หรือ dd.mm.yyyy
    const parts = val.split(/[\/\-\.]/).map(Number);
    [d, m, y] = parts;
    if (y < 100) y += 2000;   // ปี 2 หลัก เช่น 23 → 2023
    if (y > 2400) y -= 543;   // ปี พ.ศ. → ค.ศ.
  } else {
    return null; // รูปแบบไม่รู้จัก
  }

  if (isNaN(y) || isNaN(m) || isNaN(d)) return null;
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  if (y < 1900 || y > new Date().getFullYear()) return null;

  return { year: y, month: m, day: d };
}

// แปลงวันที่เป็น ISO yyyy-mm-dd สำหรับเก็บในฐานข้อมูล
function normalizeDateToISO(val) {
  const p = parseBirthDate(String(val || ""));
  if (!p) return val || "";
  return `${p.year}-${String(p.month).padStart(2,"0")}-${String(p.day).padStart(2,"0")}`;
}

// แสดงวันที่ในช่องกรอก (dd/mm/yyyy) จาก ISO
function isoToDisplay(iso) {
  const p = parseBirthDate(String(iso || ""));
  if (!p) return iso || "";
  return `${String(p.day).padStart(2,"0")}/${String(p.month).padStart(2,"0")}/${p.year}`;
}

// คำนวณอายุจากวันเกิด (รองรับทุกรูปแบบ) → {years, months, days, text}
function calculateAge(birthVal) {
  if (!birthVal) return null;
  const p = parseBirthDate(String(birthVal));
  if (!p) return null;

  const now  = new Date();
  const nowY = now.getFullYear();
  const nowM = now.getMonth() + 1; // 1-based
  const nowD = now.getDate();

  let y = nowY - p.year;
  let mo = nowM - p.month;
  let d  = nowD - p.day;

  if (d < 0) {
    mo--;
    // หาจำนวนวันในเดือนก่อนหน้า
    const prevMo  = nowM === 1 ? 12 : nowM - 1;
    const prevYr  = nowM === 1 ? nowY - 1 : nowY;
    d += new Date(prevYr, prevMo, 0).getDate();
  }
  if (mo < 0) { y--; mo += 12; }
  if (y < 0) return null; // วันเกิดในอนาคต

  return { years: y, months: mo, days: d, text: `${y} ปี ${mo} เดือน ${d} วัน` };
}

// หาช่วงอายุประเมิน → "2"/"3"/"4"/"5" หรือ null ถ้านอกช่วง
// ป้องกัน NaN: ตรวจ typeof และ isNaN ก่อนเปรียบเทียบ
function getAgeGroup(age) {
  if (!age || typeof age.years !== "number" || isNaN(age.years)) return null;
  if (age.years < 2 || age.years > 5) return null;
  if (age.years === 5 && age.months === 11 && age.days > 30) return null; // เกิน 5.11
  return String(age.years);
}

// โหลดชุดภารกิจตามอายุ
function loadTasksByAge(ageGroup) {
  return (TASK_SETS[ageGroup] || TASK_SETS["3"]).map(t => ({ ...t, correct: 0, score: 0 }));
}

// คะแนนภารกิจ = ทำถูก / จำนวนข้อ × คะแนนเต็ม
function calculateTaskScore(correct, q, max) {
  if (!q) return 0;
  return Math.round((correct / q) * max * 10) / 10;
}

// คำนวณ BMI
function calculateBMI(weight, height) {
  if (!weight || !height) return 0;
  const m = height / 100;
  return Math.round((weight / (m * m)) * 10) / 10;
}

// ให้คะแนนค่าที่อยู่ในช่วง: ในเกณฑ์=10, เบี่ยงเล็กน้อย(≤10%)=7, เบี่ยงมาก=4
function rangeScore(val, [lo, hi]) {
  if (val >= lo && val <= hi) return 10;
  if (val < lo) return (lo - val) <= lo * 0.1 ? 7 : 4;
  return (val - hi) <= hi * 0.1 ? 7 : 4;
}

// คะแนนร่างกาย 30 คะแนน (น้ำหนัก 10 + ส่วนสูง 10 + BMI 10)
function calculateBodyScore(ageGroup, weight, height, bmi) {
  const c = BODY_CRITERIA[ageGroup] || BODY_CRITERIA["3"];
  const weightScore = rangeScore(weight, c.weight);
  const heightScore = rangeScore(height, c.height);

  let bmiScore, bmiResult;
  if (bmi >= 14 && bmi <= 17.5)        { bmiScore = 10; bmiResult = "สมส่วน"; }
  else if ((bmi >= 13 && bmi < 14) || (bmi > 17.5 && bmi <= 18.9)) { bmiScore = 7; bmiResult = "เริ่มเบี่ยงเบน"; }
  else                                  { bmiScore = 4;  bmiResult = "ควรติดตาม"; }

  return { weightScore, heightScore, bmiScore, bmiResult, total: weightScore + heightScore + bmiScore };
}

// แปลผลคะแนนรวม /100
function interpretResult(total) {
  if (total >= 90) return { level: "ดี", label: "พัฒนาการเหมาะสมตามวัย", cls: "good", emoji: "😊" };
  if (total >= 80) return { level: "ดี", label: "พัฒนาการดี ควรส่งเสริมต่อเนื่อง", cls: "good", emoji: "🙂" };
  if (total >= 70) return { level: "เฝ้าระวัง", label: "ควรเฝ้าระวังบางด้าน", cls: "watch", emoji: "😐" };
  if (total >= 60) return { level: "เสี่ยง", label: "มีความเสี่ยง ควรติดตามประเมินซ้ำ", cls: "risk", emoji: "😟" };
  return { level: "เสี่ยงสูง", label: "มีความเสี่ยงสูง ควรส่งต่อผู้เชี่ยวชาญ", cls: "danger", emoji: "😢" };
}

// สร้างคำแนะนำอัตโนมัติจากภารกิจที่ทำได้ต่ำกว่า 70%
function generateSuggestions(taskScores) {
  const tips = {
    color:    "ฝึกเกมจับคู่สีวันละ 10 นาที",
    shape:    "ฝึกต่อบล็อกหรือจับคู่รูปทรง",
    letter:   "ฝึกอ่านบัตรคำ ก ข ค",
    category: "ฝึกแยกของเล่นเป็นกลุ่ม สัตว์ อาหาร ของใช้"
  };
  const out = [];
  taskScores.forEach(t => {
    if (t.max && (t.score / t.max) < 0.7 && tips[t.cat] && !out.includes(tips[t.cat])) {
      out.push(tips[t.cat]);
    }
  });
  if (!out.length) out.push("พัฒนาการโดยรวมอยู่ในเกณฑ์ดี ควรส่งเสริมกิจกรรมหลากหลายอย่างต่อเนื่อง");
  return out;
}

/* ============================================================
   ส่วนที่ 2 : Firebase + localStorage (ชั้นเก็บข้อมูล)
   ============================================================ */

// เริ่มต้น Firebase — ถ้า config ยังเป็น YOUR_ ให้ใช้ localStorage
async function initFirebase() {
  const notConfigured = Object.values(firebaseConfig).some(v => String(v).includes("YOUR_"));
  if (notConfigured) {
    DB.mode = "local";
    setCloudStatus(false, "ยังไม่ได้เชื่อมต่อ Firebase ระบบจะบันทึกข้อมูลในเครื่องชั่วคราว");
    return;
  }
  try {
    // โหลด Firebase SDK แบบ modular ผ่าน CDN เฉพาะเมื่อมี config จริง
    const appMod = await import("https://www.gstatic.com/firebasejs/12.15.0/firebase-app.js");
    const fsMod  = await import("https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js");
    const stMod  = await import("https://www.gstatic.com/firebasejs/12.15.0/firebase-storage.js");

    const app = appMod.initializeApp(firebaseConfig);
    DB.db = fsMod.getFirestore(app);
    DB.storage = stMod.getStorage(app);
    DB.fx = fsMod;       // เก็บฟังก์ชัน firestore ไว้เรียกใช้
    DB.st = stMod;       // เก็บฟังก์ชัน storage
    DB.mode = "cloud";
    setCloudStatus(true, "เชื่อมต่อ Cloud สำเร็จ");
    subscribeStudents();  // เริ่มฟังรายชื่อนักเรียนแบบเรียลไทม์
  } catch (e) {
    console.error("เชื่อมต่อ Firebase ไม่สำเร็จ:", e);
    DB.mode = "local";
    setCloudStatus(false, "เชื่อมต่อ Cloud ไม่สำเร็จ ใช้โหมดบันทึกในเครื่อง");
  }
}

/* ---- localStorage helper ---- */
function lsGet(key) { try { return JSON.parse(localStorage.getItem(key)) || []; } catch { return []; } }
function lsSet(key, val) { localStorage.setItem(key, JSON.stringify(val)); }
function genId() { return "id_" + Date.now() + "_" + Math.random().toString(36).slice(2, 7); }

// บันทึก fallback ลงเครื่อง
function saveToLocalFallback(collection, obj) {
  const arr = lsGet("gg_" + collection);
  arr.push(obj);
  lsSet("gg_" + collection, arr);
}

// อัปโหลดรูปเด็ก → คืน URL (cloud) หรือ dataURL (local)
async function uploadStudentPhoto(studentId, file, dataURL) {
  if (DB.mode === "cloud" && file) {
    try {
      const ref = DB.st.ref(DB.storage, `student_photos/${studentId}/profile.jpg`);
      await DB.st.uploadBytes(ref, file);
      return await DB.st.getDownloadURL(ref);
    } catch (e) { console.error("อัปโหลดรูปไม่สำเร็จ:", e); }
  }
  return dataURL || "";  // โหมด local เก็บ base64
}

// บันทึกนักเรียนใหม่ → คืน id เอกสาร
async function saveStudentToCloud(student) {
  if (DB.mode === "cloud") {
    const { collection, addDoc } = DB.fx;
    const docRef = await addDoc(collection(DB.db, "students"), student);
    return docRef.id;
  }
  const id = student.docId || genId();
  saveToLocalFallback("students", { ...student, docId: id });
  return id;
}

// อัปเดตข้อมูลนักเรียนเดิม
async function updateStudentToCloud(docId, fields) {
  if (DB.mode === "cloud") {
    const { doc, updateDoc } = DB.fx;
    await updateDoc(doc(DB.db, "students", docId), fields);
    return;
  }
  const arr = lsGet("gg_students");
  const i = arr.findIndex(s => s.docId === docId);
  if (i >= 0) { arr[i] = { ...arr[i], ...fields }; lsSet("gg_students", arr); }
}

// บันทึกผลการประเมิน
async function saveAssessmentToCloud(assessment) {
  if (DB.mode === "cloud") {
    const { collection, addDoc } = DB.fx;
    const docRef = await addDoc(collection(DB.db, COL_HISTORY), assessment);
    return docRef.id;
  }
  const id = genId();
  saveToLocalFallback(COL_HISTORY, { ...assessment, docId: id });
  return id;
}

// ดึงนักเรียนทั้งหมด (เรียงตาม updatedAt ล่าสุด)
async function getStudentsFromCloud() {
  if (DB.mode === "cloud") {
    const { collection, getDocs, query, orderBy } = DB.fx;
    const q = query(collection(DB.db, "students"), orderBy("updatedAt", "desc"));
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ docId: d.id, ...d.data() }));
  }
  return lsGet("gg_students").sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
}

// ดึงประวัติการประเมินของนักเรียนคนหนึ่ง (เรียงเก่า→ใหม่)
async function getAssessmentHistory(studentId) {
  let list;
  if (DB.mode === "cloud") {
    const { collection, getDocs, query, where } = DB.fx;
    const q = query(collection(DB.db, COL_HISTORY), where("studentId", "==", studentId));
    const snap = await getDocs(q);
    list = snap.docs.map(d => ({ docId: d.id, ...d.data() }));
  } else {
    list = lsGet("gg_history").filter(a => a.studentId === studentId);
  }
  return list.sort((a, b) => (a.createdAt || "").localeCompare(b.createdAt || ""));
}

// ผลล่าสุดของนักเรียน
async function getLatestAssessment(studentId) {
  const h = await getAssessmentHistory(studentId);
  return h.length ? h[h.length - 1] : null;
}

/* ---- Realtime: ฟังรายชื่อนักเรียนแบบเรียลไทม์ ---- */
function subscribeStudents() {
  if (DB.mode !== "cloud") return;
  const { collection, query, orderBy, onSnapshot } = DB.fx;
  if (unsubStudents) unsubStudents();            // ยกเลิกตัวเดิมก่อน
  const q = query(collection(DB.db, COL_STUDENTS), orderBy("updatedAt", "desc"));
  unsubStudents = onSnapshot(q,
    (snap) => {
      students = snap.docs.map(d => ({ docId: d.id, ...d.data() }));
      renderSidebarStudents(students);           // อัปเดต Sidebar ทันทีที่ข้อมูลเปลี่ยน
      if (currentStudent) {                       // ซิงค์ข้อมูลนักเรียนที่กำลังเปิดอยู่
        const fresh = students.find(s => s.docId === currentStudent.docId);
        if (fresh) currentStudent = fresh;
      }
    },
    (err) => console.error("students onSnapshot:", err)
  );
}

/* ---- Realtime: ฟังประวัติการประเมินของนักเรียนที่เปิดอยู่ ---- */
function subscribeHistory(studentId, cb) {
  if (DB.mode !== "cloud") return false;
  const { collection, query, where, onSnapshot } = DB.fx;
  if (unsubHistory) unsubHistory();
  const q = query(collection(DB.db, COL_HISTORY), where("studentId", "==", studentId));
  unsubHistory = onSnapshot(q,
    (snap) => {
      const list = snap.docs.map(d => ({ docId: d.id, ...d.data() }))
        .sort((a, b) => (a.createdAt || "").localeCompare(b.createdAt || ""));
      cb(list);                                   // เรียก render ใหม่ทุกครั้งที่มีผลใหม่
    },
    (err) => console.error("history onSnapshot:", err)
  );
  return true;
}

/* ============================================================
   ส่วนที่ 3 : Sidebar (รายชื่อนักเรียน)
   ============================================================ */

// โหลดนักเรียนทั้งหมดเข้าระบบ แล้ววาด Sidebar
async function loadAllStudents() {
  students = await getStudentsFromCloud();
  renderSidebarStudents(students);
}

// alias ตามสเปค
const renderStudentList = () => renderSidebarStudents(students);

// วาดรายชื่อใน Sidebar (แต่ละ item มีปุ่ม 🗑️ ลบ)
function renderSidebarStudents(list) {
  const box = document.getElementById("studentList");
  box.innerHTML = `<div class="list-title">รายชื่อนักเรียน (${list.length})</div>`;

  if (!list.length) {
    box.innerHTML += `<div style="padding:24px 12px;text-align:center;color:#9a96b0;font-size:13px;">
      ยังไม่มีรายชื่อนักเรียน<br>กด "+ เพิ่มนักเรียนใหม่"</div>`;
    return;
  }

  list.forEach(s => {
    const b = badgeClass(s.latestRiskLevel);
    const item = document.createElement("div");
    item.className = "student-item" +
      (currentStudent && currentStudent.docId === s.docId ? " active" : "");

    item.innerHTML = `
      ${avatarHTML(s)}
      <div class="student-meta">
        <b>${s.fullName || "-"}</b>
        <small>${s.room || "-"} · ${s.ageText || ""}</small>
      </div>
      <span class="badge ${b.cls}">${b.text}</span>
      <button class="btn-del" title="ลบนักเรียน">🗑️</button>`;

    // คลิก item → เปิดหน้าประวัติ
    item.onclick = () => selectStudentFromSidebar(s.docId);

    // คลิกปุ่มลบ → หยุด bubble + เปิด modal ยืนยัน
    const delBtn = item.querySelector(".btn-del");
    delBtn.onclick = (e) => {
      e.stopPropagation(); // ป้องกัน item.onclick ทำงาน
      showDeleteConfirm(s);
    };

    box.appendChild(item);
  });
}
// รูปวงกลม หรือ ตัวอักษรย่อ
function avatarHTML(s) {
  if (s.photoURL) return `<img class="student-avatar" src="${s.photoURL}" alt="">`;
  const initial = (s.fullName || "?").replace(/^เด็ก(หญิง|ชาย)/, "").trim().charAt(0) || "?";
  return `<div class="student-avatar">${initial}</div>`;
}

function badgeClass(level) {
  switch (level) {
    case "ดี":       return { cls: "good", text: "ดี" };
    case "เฝ้าระวัง": return { cls: "watch", text: "เฝ้าระวัง" };
    case "เสี่ยง":    return { cls: "risk", text: "เสี่ยง" };
    case "เสี่ยงสูง":  return { cls: "danger", text: "เสี่ยงสูง" };
    default:         return { cls: "none", text: "ยังไม่ทดสอบ" };
  }
}

// ค้นหาตามชื่อ/ห้อง
function searchStudentByName(term) {
  const t = term.trim().toLowerCase();
  return students.filter(s =>
    (s.fullName || "").toLowerCase().includes(t) ||
    (s.room || "").toLowerCase().includes(t));
}
function filterSidebarStudents(term) {
  renderSidebarStudents(term ? searchStudentByName(term) : students);
}

// กดชื่อนักเรียน → แสดงหน้ารวมผลของคนนั้น
async function selectStudentFromSidebar(docId) {
  closeSidebarMobile();
  currentStudent = students.find(s => s.docId === docId);
  if (!currentStudent) return;
  renderSidebarStudents(students); // อัปเดต active
  await loadStudentProfile(currentStudent);
}

// alias
const loadStudentProfile = (student) => renderStudentOverview(student);

// แสดงหน้ารวมผลของนักเรียน (Overview) — เรียลไทม์เมื่อเชื่อม Cloud
async function renderStudentOverview(student) {
  currentAgeGroup = student.ageGroup || "3";

  // ฟังก์ชันวาดหน้าจอจากประวัติที่ได้รับ
  const draw = (history) => {
    const latest = history.length ? history[history.length - 1] : null;
    if (!latest) {
      showScreen("screenDashboard");
      document.getElementById("dashboardContent").innerHTML = `
        <div class="card empty-state">
          ${avatarBig(student)}
          <h3 style="margin-top:16px;">${student.fullName}</h3>
          <div class="big">📋</div>
          <p>ยังไม่มีประวัติการประเมิน กรุณากดทดสอบครั้งแรก</p>
          <button class="btn btn-grad" id="btnFirstTest" style="margin-top:18px;padding:13px 28px;">เริ่มทดสอบครั้งแรก</button>
        </div>`;
      document.getElementById("btnFirstTest").onclick = () => startRetest(student);
      return;
    }
    renderDashboard(student, latest, history);
  };

  // โหมด Cloud → ฟังแบบเรียลไทม์ / โหมด local → ดึงครั้งเดียว
  if (!subscribeHistory(student.docId, draw)) {
    draw(await getAssessmentHistory(student.docId));
  }
}

// รีเฟรชข้อมูลจาก Cloud
async function refreshCloudStudents() {
  await loadAllStudents();
  toast(DB.mode === "cloud" ? "รีเฟรชข้อมูล Cloud สำเร็จ" : "รีเฟรชข้อมูลในเครื่องแล้ว", "ok");
}

/* ============================================================
   ระบบลบนักเรียน: Modal ยืนยัน + ลบจาก Firestore/localStorage
   ============================================================ */

// แสดง Modal ยืนยันการลบ (ไม่ใช้ window.confirm เพราะบล็อกใน iframe/มือถือ)
function showDeleteConfirm(student) {
  // ลบ modal เก่าถ้ามี
  const existing = document.getElementById("deleteModal");
  if (existing) existing.remove();

  const overlay = document.createElement("div");
  overlay.id = "deleteModal";
  overlay.className = "modal-overlay";
  overlay.innerHTML = `
    <div class="modal-box">
      <div class="modal-icon">🗑️</div>
      <h3 class="modal-title">ลบข้อมูลนักเรียน</h3>
      <p class="modal-msg">
        ต้องการลบข้อมูล <b>${student.fullName || "นักเรียน"}</b><br>
        และประวัติการประเมินทั้งหมดหรือไม่?
      </p>
      <p class="modal-warn">⚠️ การลบนี้ไม่สามารถย้อนกลับได้</p>
      <div class="modal-actions">
        <button class="btn btn-ghost" id="btnCancelDel">ยกเลิก</button>
        <button class="btn btn-danger" id="btnConfirmDel">🗑️ ลบ</button>
      </div>
    </div>`;

  document.body.appendChild(overlay);

  // ปิด modal: กด "ยกเลิก" หรือคลิกพื้นหลัง
  const closeModal = () => overlay.remove();
  document.getElementById("btnCancelDel").onclick = closeModal;
  overlay.onclick = (e) => { if (e.target === overlay) closeModal(); };

  // ยืนยันลบ
  document.getElementById("btnConfirmDel").onclick = async () => {
    closeModal();
    await deleteStudent(student.docId, student.fullName);
  };
}

// ลบนักเรียน 1 คน พร้อมประวัติทั้งหมดจาก Firestore หรือ localStorage
async function deleteStudent(docId, fullName) {
  console.log("🗑️ [deleteStudent] เริ่มลบ docId:", docId);

  try {
    if (DB.mode === "cloud") {
      const { doc, deleteDoc, collection, getDocs, query, where } = DB.fx;

      // 1) ดึงประวัติทั้งหมดที่มี studentId ตรงกัน แล้วลบทีละ doc
      const histQ = query(
        collection(DB.db, COL_HISTORY),
        where("studentId", "==", docId)
      );
      const histSnap = await getDocs(histQ);
      await Promise.all(
        histSnap.docs.map(d => deleteDoc(doc(DB.db, COL_HISTORY, d.id)))
      );
      console.log(`✅ ลบ history ${histSnap.docs.length} รายการ`);

      // 2) ลบ document ของนักเรียนใน collection students
      await deleteDoc(doc(DB.db, COL_STUDENTS, docId));
      console.log("✅ ลบนักเรียนจาก students สำเร็จ");

      // onSnapshot จะอัปเดต students[] และ Sidebar อัตโนมัติ

    } else {
      // โหมด localStorage
      const stuArr = lsGet("gg_students").filter(s => s.docId !== docId);
      lsSet("gg_students", stuArr);

      const histArr = lsGet("gg_history").filter(h => h.studentId !== docId);
      lsSet("gg_history", histArr);

      students = stuArr; // อัปเดต cache
      renderSidebarStudents(students);
      console.log("✅ ลบจาก localStorage สำเร็จ");
    }

    // ถ้านักเรียนที่ถูกลบคือคนที่กำลังเปิดอยู่ → ยกเลิก listener แล้วกลับหน้าแรก
    if (currentStudent && currentStudent.docId === docId) {
      if (unsubHistory) { unsubHistory(); unsubHistory = null; }
      currentStudent = null;
      newStudent(); // กลับหน้ากรอกข้อมูล (เพิ่มนักเรียนใหม่)
    }

    toast(`ลบข้อมูล "${fullName || "นักเรียน"}" สำเร็จ ✅`, "ok");

  } catch (err) {
    console.error("❌ [deleteStudent] error:", err);
    toast("เกิดข้อผิดพลาดในการลบ: " + (err?.message || String(err)), "warn");
  }
}

/* ============================================================
   ส่วนที่ 4 : หน้า 1 (ฟอร์มข้อมูลเด็ก)
   ============================================================ */

// ---- ระบบกรอกวันเกิดอัตโนมัติ (พิมพ์แค่ตัวเลข ระบบเติม / เอง) ----

// แปลงตัวเลข 8 หลัก → dd/mm/yyyy (ใส่ / ในตำแหน่งที่ถูกต้อง)
function formatBirthDateDisplay(digits) {
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return `${digits.slice(0,2)}/${digits.slice(2)}`;
  return `${digits.slice(0,2)}/${digits.slice(2,4)}/${digits.slice(4)}`;
}

// handler หลักของช่องวันเกิด:
// - ดึงเฉพาะตัวเลข → format → set ค่า → คำนวณอายุเมื่อครบ 8 หลัก
function handleBirthDateInput(e) {
  const input   = e.target;
  const oldVal  = input.value;
  const oldCursor = input.selectionStart ?? oldVal.length;

  // 1) ดึงแต่ตัวเลข จำกัด 8 หลัก
  const digits    = oldVal.replace(/\D/g, '').slice(0, 8);
  const formatted = formatBirthDateDisplay(digits);

  // 2) อัปเดตค่าใน input (เฉพาะเมื่อเปลี่ยนจริง)
  if (oldVal !== formatted) {
    input.value = formatted;

    // คำนวณ cursor ใหม่ให้ถูกต้องทั้งมือถือและ desktop:
    // นับ digit ที่อยู่ก่อน cursor เดิม แล้วหาตำแหน่งใน formatted
    const digBeforeCursor = oldVal.slice(0, oldCursor).replace(/\D/g, '').length;
    let pos = formatted.length; // default = ท้าย
    let cnt = 0;
    for (let i = 0; i < formatted.length; i++) {
      if (formatted[i] !== '/') cnt++;
      if (cnt === digBeforeCursor) { pos = i + 1; break; }
    }
    if (digBeforeCursor === 0) pos = 0;
    input.setSelectionRange(pos, pos);
  }

  // 3) UI ตอบสนองตามจำนวน digit
  const ageEl  = document.getElementById("ageText");
  const warnEl = document.getElementById("ageWarn");

  if (digits.length === 0) {
    // ช่องว่าง → ล้างทุกอย่าง
    if (ageEl)  ageEl.value = "";
    if (warnEl) warnEl.classList.remove("show");
    highlightAgeCard(null);

  } else if (digits.length < 8) {
    // ยังพิมพ์ไม่ครบ → แสดง hint ไม่แสดง error
    if (ageEl)  ageEl.value = `กรอกให้ครบ 8 หลัก (เหลืออีก ${8 - digits.length} หลัก)`;
    if (warnEl) warnEl.classList.remove("show");
    highlightAgeCard(null);

  } else {
    // ครบ 8 หลักแล้ว → คำนวณอายุทันที
    onBirthDateChange();
  }
}

// คำนวณอายุ + เลือกช่วงอายุ เมื่อกรอกหรือเปลี่ยนวันเกิด
function onBirthDateChange() {
  const val    = document.getElementById("birthDate").value.trim();
  const ageEl  = document.getElementById("ageText");
  const warnEl = document.getElementById("ageWarn");

  // ถ้าว่าง หรือ digit ยังไม่ครบ 8 หลัก → ไม่แสดง error ใด ๆ
  const digits = val.replace(/\D/g, '');
  if (!val || digits.length < 8) {
    if (digits.length === 0 && ageEl)  ageEl.value = "";
    if (warnEl) warnEl.classList.remove("show");
    return;
  }

  // คำนวณอายุ
  const age = calculateAge(val);
  if (!age) {
    if (ageEl)  ageEl.value = "วันที่ไม่ถูกต้อง กรุณาตรวจสอบ";
    if (warnEl) warnEl.classList.remove("show");
    highlightAgeCard(null);
    return;
  }

  if (ageEl) ageEl.value = age.text;
  const group = getAgeGroup(age);
  if (!group) {
    if (warnEl) warnEl.classList.add("show");
    highlightAgeCard(null);
  } else {
    if (warnEl) warnEl.classList.remove("show");
    currentAgeGroup = group;
    highlightAgeCard(group);
  }
}

function highlightAgeCard(group) {
  document.querySelectorAll(".age-card").forEach(c =>
    c.classList.toggle("active", c.dataset.age === group));
}

// แก้ไขข้อมูลเด็ก → เปิดฟอร์มพร้อมข้อมูลเดิม
function editStudentProfile(student) {
  const s = student || currentStudent;
  if (!s) return;
  currentStudent = s;
  showScreen("screenStep1");
  document.getElementById("fullName").value = s.fullName || "";
  document.getElementById("birthDate").value = s.birthDate ? isoToDisplay(s.birthDate) : "";
  document.getElementById("room").value = s.room || "";
  document.getElementById("weight").value = s.weight || "";
  document.getElementById("height").value = s.height || "";
  document.querySelectorAll('input[name="gender"]').forEach(r => r.checked = (r.value === s.gender));
  currentPhotoData = s.photoURL || null;
  currentPhotoFile = null;
  const box = document.getElementById("photoBox");
  box.innerHTML = s.photoURL ? `<img src="${s.photoURL}" alt="">`
                             : `<div class="ph"><span class="big">📷</span>ยังไม่มีรูปภาพ</div>`;
  onBirthDateChange();
}

// บันทึกฟอร์ม แล้วไปหน้า 2 — มี try-catch และ console.log ทุกขั้น
async function submitStep1() {
  console.log("📋 [submitStep1] เริ่มต้น...");

  // 1) อ่านค่าจากฟอร์ม
  const fullName    = document.getElementById("fullName").value.trim();
  const birthDateRaw= document.getElementById("birthDate").value.trim();
  const room        = document.getElementById("room").value.trim();
  const gender      = document.querySelector('input[name="gender"]:checked')?.value || "หญิง";
  const weight      = parseFloat(document.getElementById("weight").value);
  const height      = parseFloat(document.getElementById("height").value);

  console.log("📝 ข้อมูลฟอร์ม:", { fullName, birthDateRaw, room, gender, weight, height });

  // 2) ตรวจสอบแต่ละช่อง (แสดง toast ชี้จุดที่ขาด)
  if (!fullName) {
    toast("⚠️ กรุณากรอกชื่อ - นามสกุล", "warn");
    document.getElementById("fullName").focus();
    return;
  }
  if (!birthDateRaw) {
    toast("⚠️ กรุณากรอกวันเกิด", "warn");
    document.getElementById("birthDate").focus();
    return;
  }

  const age = calculateAge(birthDateRaw);
  console.log("🎂 อายุที่คำนวณได้:", age);

  if (!age) {
    toast("⚠️ วันเกิดไม่ถูกต้อง — กรอก วว/ดด/ปปปป เช่น 27/07/2023", "warn");
    document.getElementById("birthDate").focus();
    return;
  }

  const group = getAgeGroup(age);
  console.log("👶 ช่วงอายุ:", group, " | อายุ:", age.text);

  if (!group) {
    toast(`⚠️ อายุ ${age.text} อยู่นอกช่วงประเมิน (รองรับ 2 ปี – 5 ปี 11 เดือน)`, "warn");
    return;
  }
  if (!room) {
    toast("⚠️ กรุณากรอกห้องเรียน", "warn");
    document.getElementById("room").focus();
    return;
  }
  if (isNaN(weight) || weight <= 0) {
    toast("⚠️ กรุณากรอกน้ำหนักให้ถูกต้อง", "warn");
    document.getElementById("weight").focus();
    return;
  }
  if (isNaN(height) || height <= 0) {
    toast("⚠️ กรุณากรอกส่วนสูงให้ถูกต้อง", "warn");
    document.getElementById("height").focus();
    return;
  }

  // 3) ข้อมูลครบ — เตรียมบันทึก
  const birthDate = normalizeDateToISO(birthDateRaw); // เก็บเป็น ISO yyyy-mm-dd
  const bmi = calculateBMI(weight, height);
  const now = new Date().toISOString();
  currentAgeGroup = group;

  const isEditing = !!(currentStudent && currentStudent.docId);
  const studentId = isEditing
    ? currentStudent.studentId
    : ("STD" + Date.now().toString().slice(-6));

  // 4) อัปโหลดรูป (ถ้ามี)
  let photoURL = currentStudent?.photoURL || "";
  if (currentPhotoFile || currentPhotoData) {
    try {
      photoURL = await uploadStudentPhoto(studentId, currentPhotoFile, currentPhotoData);
    } catch (photoErr) {
      console.warn("อัปโหลดรูปล้มเหลว ข้ามไป:", photoErr);
    }
  }

  const base = {
    studentId, fullName, birthDate,
    ageText: age.text, ageGroup: group, room, gender,
    weight, height, bmi, photoURL, updatedAt: now
  };

  // 5) บันทึกลงฐานข้อมูล (Cloud หรือ local)
  try {
    if (isEditing) {
      console.log("✏️ อัปเดตนักเรียนเดิม docId:", currentStudent.docId);
      await updateStudentToCloud(currentStudent.docId, base);
      currentStudent = { ...currentStudent, ...base };
      toast("อัปเดตข้อมูลนักเรียนแล้ว ✅", "ok");
    } else {
      const newStudent = { ...base, latestScore: null, latestRiskLevel: null, createdAt: now };
      console.log("➕ บันทึกนักเรียนใหม่:", newStudent);
      const docId = await saveStudentToCloud(newStudent);
      currentStudent = { ...newStudent, docId };
      toast(DB.mode === "cloud"
        ? "บันทึกนักเรียนขึ้น Cloud สำเร็จ ✅"
        : "บันทึกนักเรียนในเครื่องแล้ว ✅", "ok");
    }

    await loadAllStudents();        // เพิ่มชื่อใน Sidebar ทันที
    renderSidebarStudents(students);
    console.log("✅ [submitStep1] สำเร็จ → ไปหน้า 2");
    enterStep2();

  } catch (err) {
    console.error("❌ [submitStep1] error:", err);
    toast("เกิดข้อผิดพลาด: " + (err?.message || String(err)), "warn");
  }
}

/* ============================================================
   ส่วนที่ 5 : หน้า 2 (ทดสอบภารกิจ)
   ============================================================ */

async function enterStep2() {
  showScreen("screenStep2");
  currentTaskScores = loadTasksByAge(currentAgeGroup);
  document.getElementById("taskTitle").textContent =
    `ภารกิจตามช่วงอายุ ${currentAgeGroup} ปี (${currentTaskScores.reduce((a, t) => a + t.q, 0)} ข้อ)`;

  // วันที่/ครั้งที่
  const now = new Date();
  document.getElementById("testDate").textContent =
    `${formatShort(now.toISOString())}  ${String(now.getHours()).padStart(2,"0")}:${String(now.getMinutes()).padStart(2,"0")} น.`;
  const hist = currentStudent ? await getAssessmentHistory(currentStudent.docId) : [];
  document.getElementById("testRound").textContent = hist.length + 1;

  renderTaskTable(false);
}

// วาดตารางภารกิจ (editable = เปิดให้กรอกเอง)
function renderTaskTable(editable) {
  const body = document.getElementById("taskBody");
  body.innerHTML = "";
  currentTaskScores.forEach((t, i) => {
    t.score = calculateTaskScore(t.correct, t.q, t.max);
    const pct = t.max ? (t.score / t.max) : 0;
    const color = pct >= 0.7 ? "var(--good)" : pct >= 0.5 ? "var(--watch)" : "var(--risk)";
    const tr = document.createElement("tr");
    tr.className = "task-row";
    tr.innerHTML = `
      <td>
        <div class="task-name">
          <span class="tic">${t.icon}</span>
          <span><b>${i + 1}. ${t.name}</b></span>
        </div>
      </td>
      <td>${t.q}</td>
      <td><input class="correct-input" type="number" min="0" max="${t.q}" value="${t.correct}"
            data-i="${i}" ${editable ? "" : "disabled"}></td>
      <td class="score-cell"><b>${t.score.toFixed(1)}</b>
          <div class="bar"><i style="width:${pct*100}%;background:${color};"></i></div>
      </td>
      <td class="score-cell"><small>/ ${t.max}</small></td>`;
    body.appendChild(tr);
  });

  // ผูก event ช่องกรอกคะแนน
  body.querySelectorAll(".correct-input").forEach(inp => {
    inp.oninput = () => {
      const i = +inp.dataset.i;
      let v = Math.max(0, Math.min(currentTaskScores[i].q, parseInt(inp.value) || 0));
      currentTaskScores[i].correct = v;
      renderTaskTable(editable);
    };
  });

  updateTaskTotal();
}

function updateTaskTotal() {
  const total = currentTaskScores.reduce((a, t) => a + t.score, 0);
  document.getElementById("taskTotal").innerHTML = `${total.toFixed(1)}<small> / 70</small>`;
}

// ลิงก์ข้อมูลจาก micro:bit (จำลอง: สุ่มจำนวนข้อที่ทำถูก)
function linkMicrobit() {
  currentTaskScores.forEach(t => {
    // สุ่มให้เอนเอียงไปทางทำได้ดี (60–100%)
    t.correct = Math.round(t.q * (0.6 + Math.random() * 0.4));
  });
  renderTaskTable(false);
  toast("รับข้อมูลจาก micro:bit สำเร็จ", "ok");
}

/* ============================================================
   ส่วนที่ 6 : หน้า 3 (Dashboard สรุปผล)
   ============================================================ */

// กดดูผลสรุป → คำนวณ + บันทึก assessment + อัปเดต student
async function goToStep3() {
  if (!currentStudent) return toast("ไม่พบข้อมูลนักเรียน", "warn");

  const { weight, height } = currentStudent;
  const bmi = calculateBMI(weight, height);
  const body = calculateBodyScore(currentAgeGroup, weight, height, bmi);
  const taskTotal = currentTaskScores.reduce((a, t) => a + t.score, 0);
  const total = Math.round((taskTotal + body.total) * 10) / 10;
  const result = interpretResult(total);
  const suggestions = generateSuggestions(currentTaskScores);
  const now = new Date().toISOString();

  const assessment = {
    assessmentId: genId(),
    studentId: currentStudent.docId,
    fullName: currentStudent.fullName,
    ageGroup: currentAgeGroup,
    weight, height, bmi,
    taskScores: currentTaskScores.map(t => ({ name: t.name, cat: t.cat, q: t.q, correct: t.correct, score: t.score, max: t.max })),
    taskTotalScore: Math.round(taskTotal * 10) / 10,
    bodyScore: body,
    totalScore: total,
    bmiResult: body.bmiResult,
    riskLevel: result.level,
    suggestions,
    createdAt: now
  };

  // บันทึกผลลง assessments
  await saveAssessmentToCloud(assessment);
  // อัปเดตผลล่าสุดของนักเรียน
  await updateStudentToCloud(currentStudent.docId, {
    latestScore: total, latestRiskLevel: result.level, bmi, updatedAt: now
  });
  currentStudent.latestScore = total;
  currentStudent.latestRiskLevel = result.level;

  await loadAllStudents();
  renderSidebarStudents(students);

  const history = await getAssessmentHistory(currentStudent.docId);
  renderDashboard(currentStudent, assessment, history);
  toast("บันทึกผลการประเมินสำเร็จ", "ok");
}

// วาด Dashboard สรุปผล (ใช้ทั้งหน้า 3 และหน้ารวมผล)
function renderDashboard(student, a, history) {
  showScreen("screenDashboard");
  const result = interpretResult(a.totalScore);
  const body = a.bodyScore;
  const age = student.ageText || (student.birthDate ? calculateAge(student.birthDate).text : "");

  // สรุประดับความเสี่ยงรายด้าน
  const motorPct = ((a.taskScores[0].score + a.taskScores[1].score) / (a.taskScores[0].max + a.taskScores[1].max));
  const cogPct   = ((a.taskScores[2].score + a.taskScores[3].score) / (a.taskScores[2].max + a.taskScores[3].max));
  const sideLevel = p => p >= 0.8 ? { d: "good", t: "พัฒนาการดี" } : p >= 0.6 ? { d: "watch", t: "ควรส่งเสริม" } : { d: "risk", t: "ควรติดตาม" };
  const m = sideLevel(motorPct), c = sideLevel(cogPct);
  const bodyLv = body.total >= 25 ? { d: "good", t: "ปกติ" } : body.total >= 18 ? { d: "watch", t: "ควรติดตาม" } : { d: "risk", t: "เสี่ยง" };

  const html = `
  <div class="card">
    <div class="card-head" style="justify-content:space-between;">
      <div style="display:flex;align-items:center;gap:10px;"><span class="ic">📊</span><h2>สรุปผลการประเมิน</h2></div>
      <button class="btn btn-ghost" id="btnPrint">🖨️ พิมพ์รายงาน</button>
    </div>
    <div class="card-sub">วิเคราะห์พัฒนาการและสุขภาพ</div>

    <div class="dash-top">
      <!-- ข้อมูลเด็ก -->
      <div class="card profile-card" style="box-shadow:none;border:1.5px solid var(--line);margin:0;">
        ${avatarBig(student)}
        <div class="profile-info">
          <h2>${student.fullName}</h2>
          <div class="prow"><span>วันเกิด</span> ${formatThaiDate(student.birthDate)}</div>
          <div class="prow"><span>อายุ</span> ${age}</div>
          <div class="prow"><span>ห้อง</span> ${student.room || "-"}</div>
          <div class="prow"><span>เพศ</span> ${student.gender || "-"}</div>
          <div class="prow"><span>น้ำหนัก</span> ${student.weight} กก.</div>
          <div class="prow"><span>ส่วนสูง</span> ${student.height} ซม.</div>
        </div>
      </div>
      <!-- คะแนนรวม -->
      <div class="card score-hero" style="box-shadow:none;border:1.5px solid var(--line);margin:0;">
        <div class="lab">คะแนนรวม</div>
        <div class="big">${a.totalScore.toFixed(1)}<small> / 100</small></div>
        <div class="lab2">ระดับความเสี่ยง</div>
        <div class="risk-pill ${result.cls}"><span class="em">${result.emoji}</span> ${result.label}</div>
      </div>
    </div>
  </div>

  <!-- กราฟการเจริญเติบโต + BMI -->
  <div class="card">
    <div class="card-head"><span class="ic">📈</span><h2>กราฟแสดงการเจริญเติบโต</h2></div>
    <div class="growth-grid">
      <div class="chart-box"><h4>น้ำหนักตามเกณฑ์อายุ (กก.)</h4><div class="chart-wrap"><canvas id="chartWeight"></canvas></div></div>
      <div class="chart-box"><h4>ส่วนสูงตามเกณฑ์อายุ (ซม.)</h4><div class="chart-wrap"><canvas id="chartHeight"></canvas></div></div>
      <div class="bmi-box card" style="box-shadow:none;border:1.5px solid var(--line);margin:0;">
        <div class="lab">ค่า BMI</div>
        <div class="big">${a.bmi.toFixed(1)}</div>
        <div class="note">อยู่ในเกณฑ์ ${a.bmiResult}</div>
        <div class="bmi-tag ${body.bmiScore===10?'risk-pill good':body.bmiScore===7?'risk-pill watch':'risk-pill risk'}"
             style="display:inline-block;">${a.bmiResult}</div>
      </div>
    </div>
  </div>

  <!-- การ์ดคะแนน 3 ใบ -->
  <div class="score-grid">
    <div class="card mini-card purple" style="margin:0;">
      <h3>คะแนนพัฒนาการ</h3>
      ${a.taskScores.map((t, i) => `<div class="mini-row"><span>${i+1}. ${shortName(t.name)}</span><b>${t.score.toFixed(1)} / ${t.max}</b></div>`).join("")}
      <div class="mini-row sum"><span>รวมพัฒนาการ</span><b>${a.taskTotalScore.toFixed(1)} / 70</b></div>
    </div>
    <div class="card mini-card green" style="margin:0;">
      <h3>คะแนนพัฒนาการด้านร่างกาย</h3>
      <div class="mini-row"><span>น้ำหนักตามเกณฑ์</span><b>${body.weightScore} / 10</b></div>
      <div class="mini-row"><span>ส่วนสูงตามเกณฑ์</span><b>${body.heightScore} / 10</b></div>
      <div class="mini-row"><span>BMI ตามเกณฑ์</span><b>${body.bmiScore} / 10</b></div>
      <div class="mini-row sum"><span>รวม</span><b style="color:#1f8a3b;">${body.total} / 30</b></div>
    </div>
    <div class="card mini-card pink" style="margin:0;">
      <h3>สรุประดับความเสี่ยงรายด้าน</h3>
      <div class="mini-row"><span><span class="dot ${m.d}"></span>กล้ามเนื้อ/การรับรู้</span><b>${m.t}</b></div>
      <div class="mini-row"><span><span class="dot ${c.d}"></span>สติปัญญา/ภาษา</span><b>${c.t}</b></div>
      <div class="mini-row"><span><span class="dot ${bodyLv.d}"></span>ร่างกาย</span><b>${bodyLv.t}</b></div>
    </div>
  </div>

  <!-- ประวัติ + ความก้าวหน้า -->
  <div class="card">
    <div class="history-grid">
      <div>
        <div class="card-head"><span class="ic">📋</span><h2 style="font-size:17px;">ประวัติการทดสอบ</h2></div>
        <table class="hist-table">
          <thead><tr><th>วันที่</th><th>คะแนนรวม</th><th>ระดับผล</th></tr></thead>
          <tbody>
            ${[...history].reverse().map(h => {
              const r = interpretResult(h.totalScore);
              return `<tr><td>${formatShort(h.createdAt)}</td><td><b>${h.totalScore.toFixed(1)}</b></td>
                      <td class="lvl"><span class="badge ${r.cls}">${r.level}</span></td></tr>`;
            }).join("")}
          </tbody>
        </table>
      </div>
      <div>
        <div class="card-head"><span class="ic">🚀</span><h2 style="font-size:17px;">ความก้าวหน้า</h2></div>
        <div class="card-sub">กราฟแสดงความก้าวหน้าของคะแนนรวม</div>
        <div class="chart-wrap"><canvas id="chartProgress"></canvas></div>
      </div>
    </div>
  </div>

  <!-- คำแนะนำ -->
  <div class="suggest-box">
    <span class="ic">💡</span>
    <div><b>คำแนะนำ :</b>
      <ul>${a.suggestions.map(s => `<li>${s}</li>`).join("")}</ul>
    </div>
  </div>

  <!-- ปุ่ม -->
  <div class="dash-actions">
    <button class="btn btn-soft" id="btnSaveResult">💾 บันทึกผล</button>
    <button class="btn btn-soft" id="btnPrint2">🖨️ พิมพ์รายงาน</button>
    <button class="btn btn-grad" id="btnRetest">🔄 ทดสอบคนเดิมอีกครั้ง</button>
    <button class="btn btn-ghost" id="btnEdit">✏️ แก้ไขข้อมูลเด็ก</button>
    <button class="btn btn-ghost" id="btnHome">🏠 กลับหน้าแรก</button>
  </div>

  <div class="disclaimer">
    ผลการประเมินนี้เป็นการคัดกรองเบื้องต้น ไม่ใช่การวินิจฉัยทางการแพทย์<br>
    หากพบความเสี่ยงสูงควรปรึกษาผู้เชี่ยวชาญ
  </div>`;

  document.getElementById("dashboardContent").innerHTML = html;

  // ผูกปุ่ม
  document.getElementById("btnPrint").onclick = printReport;
  document.getElementById("btnPrint2").onclick = printReport;
  document.getElementById("btnSaveResult").onclick = () => toast("ผลถูกบันทึกเรียบร้อยแล้ว", "ok");
  document.getElementById("btnRetest").onclick = () => startRetest(student);
  document.getElementById("btnEdit").onclick = () => editStudentProfile(student);
  document.getElementById("btnHome").onclick = goHome;

  renderCharts(a, history, student);
}

// ชื่อภารกิจแบบสั้นในการ์ด
function shortName(n) {
  return n.replace("จำแนกตัวอักษร", "ตัวอักษร").replace("แยกหมวดหมู่", "หมวดหมู่").split(" ")[0] +
         (n.includes("สี") ? " (สี)" : n.includes("รูปทรง") ? " (รูปทรง)" : n.includes("อักษร") ? " (อักษร)" : " (หมวดหมู่)");
}

/* ---- กราฟ Chart.js ---- */
function renderCharts(a, history, student) {
  Object.values(charts).forEach(c => c && c.destroy());
  const ages = ["2","3","4","5"];
  const labels = ["2 ปี","3 ปี","4 ปี","5 ปี"];
  const purple = "#7c5ce6", green = "#34c759";

  // เส้นเด็กจากประวัติ (น้ำหนัก/ส่วนสูง ตามช่วงอายุล่าสุดของแต่ละช่วง)
  const childW = ages.map(g => { const f = [...history].reverse().find(h => h.ageGroup === g); return f ? f.weight : null; });
  const childH = ages.map(g => { const f = [...history].reverse().find(h => h.ageGroup === g); return f ? f.height : null; });

  const baseOpts = {
    responsive: true, maintainAspectRatio: false,
    plugins: { legend: { position: "bottom", labels: { font: { family: "Prompt", size: 11 }, usePointStyle: true } } },
    scales: { x: { grid: { display: false }, ticks: { font: { family: "Prompt" } } },
              y: { grid: { color: "#f0eefa" }, ticks: { font: { family: "Prompt" } } } }
  };

  // 1) น้ำหนักตามอายุ
  charts.weight = new Chart(document.getElementById("chartWeight"), {
    type: "line",
    data: { labels, datasets: [
      { label: "เด็ก", data: childW, borderColor: purple, backgroundColor: purple, tension: .35, spanGaps: true, pointRadius: 5 },
      { label: "เกณฑ์มาตรฐาน", data: ages.map(g => STD_WEIGHT[g]), borderColor: green, borderDash: [6,4], tension: .35, pointRadius: 3 }
    ]}, options: baseOpts
  });

  // 2) ส่วนสูงตามอายุ
  charts.height = new Chart(document.getElementById("chartHeight"), {
    type: "line",
    data: { labels, datasets: [
      { label: "เด็ก", data: childH, borderColor: purple, backgroundColor: purple, tension: .35, spanGaps: true, pointRadius: 5 },
      { label: "เกณฑ์มาตรฐาน", data: ages.map(g => STD_HEIGHT[g]), borderColor: green, borderDash: [6,4], tension: .35, pointRadius: 3 }
    ]}, options: baseOpts
  });

  // 3) ความก้าวหน้าคะแนนรวม
  charts.progress = new Chart(document.getElementById("chartProgress"), {
    type: "line",
    data: { labels: history.map(h => formatShort(h.createdAt)),
      datasets: [{ label: "คะแนนรวม", data: history.map(h => h.totalScore),
        borderColor: green, backgroundColor: "rgba(52,199,89,.12)", fill: true, tension: .3, pointRadius: 5,
        pointBackgroundColor: "#fff", pointBorderColor: green, pointBorderWidth: 2 }] },
    options: { ...baseOpts, scales: { ...baseOpts.scales, y: { ...baseOpts.scales.y, min: 0, max: 100 } } }
  });
}

/* ============================================================
   ส่วนที่ 7 : การทดสอบซ้ำ / นำทาง / Toast / รูปแบบวันที่
   ============================================================ */

// ทดสอบนักเรียนคนเดิมอีกครั้ง
function startRetest(student) {
  currentStudent = student || currentStudent;
  currentAgeGroup = currentStudent.ageGroup || "3";
  enterStep2();
}

// เริ่มฟอร์มนักเรียนใหม่
function newStudent() {
  currentStudent = null;
  currentPhotoFile = null; currentPhotoData = null;
  document.getElementById("fullName").value = "";
  document.getElementById("birthDate").value = "";
  document.getElementById("room").value = "";
  document.getElementById("weight").value = "";
  document.getElementById("height").value = "";
  document.getElementById("ageText").value = "";
  document.querySelector('input[name="gender"][value="หญิง"]').checked = true;
  document.getElementById("photoBox").innerHTML = `<div class="ph"><span class="big">📷</span>ยังไม่มีรูปภาพ</div>`;
  document.getElementById("ageWarn").classList.remove("show");
  highlightAgeCard(null);
  showScreen("screenStep1");
  closeSidebarMobile();
}

function goHome() {
  showScreen("screenStep1");
  renderSidebarStudents(students);
}

// แสดงหน้าจอ (step)
function showScreen(id) {
  document.querySelectorAll(".screen").forEach(s => s.classList.toggle("active", s.id === id));
  window.scrollTo({ top: 0, behavior: "smooth" });
}

// พิมพ์รายงาน
function printReport() { window.print(); }

// แถบสถานะ Cloud
function setCloudStatus(online, msg) {
  const el = document.getElementById("cloudStatus");
  el.className = "cloud-status " + (online ? "online" : "offline");
  el.textContent = (online ? "✅ " : "⚠️ ") + msg;
}

// Toast แจ้งเตือน
function toast(msg, type = "") {
  const wrap = document.getElementById("toastWrap");
  const el = document.createElement("div");
  el.className = "toast " + type;
  el.innerHTML = `<span>${type === "ok" ? "✅" : type === "warn" ? "⚠️" : "ℹ️"}</span> ${msg}`;
  wrap.appendChild(el);
  setTimeout(() => el.remove(), 3000);
}

// วันที่ไทยเต็ม: 15 มีนาคม 2564
function formatThaiDate(iso) {
  if (!iso) return "-";
  const d = new Date(iso);
  return `${d.getDate()} ${THAI_MONTHS[d.getMonth()]} ${d.getFullYear() + 543}`;
}
// วันที่สั้น: 20/05/2567
function formatShort(iso) {
  if (!iso) return "-";
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2,"0")}/${String(d.getMonth()+1).padStart(2,"0")}/${d.getFullYear()+543}`;
}

// รูปใหญ่ในหน้า Dashboard
function avatarBig(s) {
  if (s.photoURL) return `<img class="profile-photo" src="${s.photoURL}" alt="">`;
  const initial = (s.fullName || "?").replace(/^เด็ก(หญิง|ชาย)/, "").trim().charAt(0) || "?";
  return `<div class="profile-photo">${initial}</div>`;
}

/* ============================================================
   ส่วนที่ 8 : ข้อมูลตัวอย่าง (ให้ทดลองระบบได้ทันที)
   ============================================================ */
// สร้างอ็อบเจกต์นักเรียนตัวอย่าง
function buildSampleStudent() {
  const age = calculateAge("2021-03-15");
  return {
    studentId: "STD000123",
    fullName: "เด็กหญิงกัญญา ใจดี", birthDate: "2021-03-15",
    ageText: age.text, ageGroup: getAgeGroup(age) || "3",
    room: "อนุบาล 1/2", gender: "หญิง",
    weight: 13.5, height: 95, bmi: 14.9, photoURL: "",
    latestScore: 84.6, latestRiskLevel: "ดี",
    createdAt: "2023-11-10T03:00:00.000Z", updatedAt: "2024-05-20T03:00:00.000Z"
  };
}

// สร้างประวัติการประเมินตัวอย่าง 3 ครั้ง (68.1 → 76.2 → 84.6)
function buildSampleHistory(studentDocId, fullName) {
  const mk = (total, w, h, date) => {
    const tasks = loadTasksByAge("3").map(t => {
      const cc = Math.max(0, Math.min(t.q, Math.round(t.q * (total / 100) * (0.9 + Math.random() * 0.2))));
      return { name: t.name, cat: t.cat, q: t.q, correct: cc, score: calculateTaskScore(cc, t.q, t.max), max: t.max };
    });
    const taskTotal = tasks.reduce((a, t) => a + t.score, 0);
    const bmi = calculateBMI(w, h);
    const body = calculateBodyScore("3", w, h, bmi);
    const r = interpretResult(total);
    return {
      assessmentId: genId(), studentId: studentDocId, fullName, ageGroup: "3",
      weight: w, height: h, bmi, taskScores: tasks, taskTotalScore: Math.round(taskTotal * 10) / 10,
      bodyScore: body, totalScore: total, bmiResult: body.bmiResult, riskLevel: r.level,
      suggestions: generateSuggestions(tasks), createdAt: date
    };
  };
  return [
    mk(68.1, 12.0, 90, "2023-11-10T03:15:00.000Z"),
    mk(76.2, 12.8, 92, "2024-02-15T03:15:00.000Z"),
    mk(84.6, 13.5, 95, "2024-05-20T03:15:00.000Z")
  ];
}

// ใส่ข้อมูลตัวอย่างในเครื่อง (โหมด local) เฉพาะครั้งแรก
function seedSampleData() {
  if (lsGet("gg_students").length) return;
  const student = buildSampleStudent();
  student.docId = genId();
  lsSet("gg_students", [student]);
  lsSet("gg_history", buildSampleHistory(student.docId, student.fullName));
}

// สร้าง collection students + history บน Firestore ครั้งแรก (ถ้ายังว่าง)
async function ensureCloudSeed() {
  if (DB.mode !== "cloud") return;
  try {
    const { collection, getDocs } = DB.fx;
    const snap = await getDocs(collection(DB.db, COL_STUDENTS));
    if (!snap.empty) return;                          // มีข้อมูลแล้ว ไม่ต้อง seed
    const docId = await saveStudentToCloud(buildSampleStudent());   // สร้าง collection students
    for (const h of buildSampleHistory(docId, "เด็กหญิงกัญญา ใจดี")) {
      await saveAssessmentToCloud(h);                 // สร้าง collection history
    }
    toast("สร้างข้อมูลตัวอย่างบน Cloud สำเร็จ", "ok");
  } catch (e) {
    console.error("ensureCloudSeed:", e);
  }
}

/* ============================================================
   ส่วนที่ 9 : เริ่มต้นระบบ + ผูก Event
   ============================================================ */
async function init() {
  await initFirebase();                          // เชื่อม Cloud หรือใช้ local
  if (DB.mode === "cloud") await ensureCloudSeed(); // สร้าง collection + ตัวอย่างบน Cloud
  else seedSampleData();                          // ใส่ตัวอย่างในเครื่อง
  await loadAllStudents();                        // โหลดรายชื่อเข้า Sidebar

  // หน้า 1 — ช่องวันเกิด: ใช้ handleBirthDateInput (เติม / อัตโนมัติ)
  const bdEl = document.getElementById("birthDate");
  bdEl.addEventListener("input", handleBirthDateInput);  // ทุกครั้งที่พิมพ์/ลบ
  bdEl.addEventListener("blur",  onBirthDateChange);     // ตรวจสอบเมื่อออกจากช่อง

  // ตรวจสอบว่าปุ่มมีอยู่จริงก่อนผูก event
  const btnStep2 = document.getElementById("btnToStep2");
  if (btnStep2) {
    btnStep2.onclick = submitStep1;
    console.log("✅ btnToStep2 ผูก submitStep1 แล้ว");
  } else {
    console.error("❌ ไม่พบ btnToStep2 ใน DOM");
  }

  document.getElementById("btnUploadPhoto").onclick = () => document.getElementById("photoInput").click();
  document.getElementById("photoInput").onchange = (e) => {
    const file = e.target.files[0]; if (!file) return;
    currentPhotoFile = file;
    const reader = new FileReader();
    reader.onload = ev => {
      currentPhotoData = ev.target.result;
      document.getElementById("photoBox").innerHTML = `<img src="${currentPhotoData}" alt="">`;
    };
    reader.readAsDataURL(file);
  };
  document.querySelectorAll(".age-card").forEach(c => c.onclick = () => {
    currentAgeGroup = c.dataset.age; highlightAgeCard(c.dataset.age);
  });

  // หน้า 2
  document.getElementById("btnLinkMicrobit").onclick = linkMicrobit;
  document.getElementById("btnManualScore").onclick = () => { renderTaskTable(true); toast("กรอกจำนวนข้อที่ทำถูกได้เลย", ""); };
  document.getElementById("btnBackStep1").onclick = () => showScreen("screenStep1");
  document.getElementById("btnToStep3").onclick = goToStep3;

  // Sidebar
  document.getElementById("btnNewStudent").onclick = newStudent;
  document.getElementById("btnRefresh").onclick = refreshCloudStudents;
  document.getElementById("searchInput").oninput = (e) => filterSidebarStudents(e.target.value);

  // เมนูมือถือ
  document.getElementById("menuBtn").onclick = () => {
    document.getElementById("sidebar").classList.add("open");
    document.getElementById("sidebarOverlay").classList.add("show");
  };
  document.getElementById("sidebarOverlay").onclick = closeSidebarMobile;

  highlightAgeCard(currentAgeGroup);
}

function closeSidebarMobile() {
  document.getElementById("sidebar").classList.remove("open");
  document.getElementById("sidebarOverlay").classList.remove("show");
}

// เริ่ม!
init();
