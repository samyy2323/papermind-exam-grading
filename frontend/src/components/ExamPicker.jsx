// Dropdown of published exams, used by the review and analytics pages.
export default function ExamPicker({ exams, value, onChange, id = 'exam-picker' }) {
  return (
    <div className="w-full sm:w-80">
      <label htmlFor={id} className="field-label">
        Exam
      </label>
      <select id={id} className="field" value={value || ''} onChange={(e) => onChange(e.target.value)}>
        {exams.map((e) => (
          <option key={e.id} value={e.id}>
            {e.title} — {e.subject}
          </option>
        ))}
      </select>
    </div>
  );
}
