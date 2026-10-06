import React from 'react';
import { createRoot } from 'react-dom/client';
import './style.css';

const cards = [
  ['โครงการ', 'Sea Mountain'],
  ['ค่าใช้จ่ายเดือนนี้', '—'],
  ['รอจ่าย', '—'],
  ['เอกสารรอตรวจ', '—'],
];

function App() {
  return (
    <main>
      <header>
        <div>
          <p className="eyebrow">Vela Construction Expense</p>
          <h1>Sea Mountain</h1>
          <p>ระบบบันทึกค่าใช้จ่ายและเอกสารโครงการก่อสร้าง</p>
        </div>
        <button>+ บันทึกค่าใช้จ่าย</button>
      </header>
      <section className="grid">
        {cards.map(([label, value]) => <article key={label}><span>{label}</span><strong>{value}</strong></article>)}
      </section>
      <section className="panel">
        <h2>เมนูหลัก</h2>
        <div className="menu">
          {['ค่าใช้จ่าย','เอกสาร','ผู้ขาย / ผู้รับเหมา','Cost Codes','รายงาน','ตั้งค่า'].map(x => <button key={x}>{x}</button>)}
        </div>
      </section>
    </main>
  );
}

createRoot(document.getElementById('root')).render(<App />);
