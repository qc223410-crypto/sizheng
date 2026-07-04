const subjectBanks = window.SUBJECT_BANKS && typeof window.SUBJECT_BANKS === 'object'
  ? window.SUBJECT_BANKS
  : { [window.DEFAULT_SUBJECT_NAME || '国家安全']: Array.isArray(window.QUESTION_BANK) ? window.QUESTION_BANK : [] };
const subjectNames = Object.keys(subjectBanks);
const defaultSubject = subjectNames.includes(window.DEFAULT_SUBJECT_NAME) ? window.DEFAULT_SUBJECT_NAME : subjectNames[0];
const subjectStorageKey = 'quiz-current-subject-v1';
const wrongStoragePrefix = 'quiz-wrong-question-ids-v3';
const streakStoragePrefix = 'quiz-wrong-correct-streak-v2';
const examSize = 140;
const examTypeOrder = ['single', 'multiple', 'judge'];
const examPlans = {
  '国家安全': { single: 112, multiple: 28 },
  '思政': { single: 56, multiple: 28, judge: 56 },
};

let currentSubject = loadSubject();
let questions = getSubjectQuestions(currentSubject);
let mode = 'all';
let index = 0;
let answered = false;
let wrongIds = loadWrongIds();
let wrongCorrectStreak = loadWrongCorrectStreak();
let practiceResults = new Map();
let examQuestions = [];
let examAnswers = new Map();
let examSubmitted = false;

const subjectSelect = document.getElementById('subject-select');
const totalCount = document.getElementById('total-count');
const wrongCount = document.getElementById('wrong-count');
const allMode = document.getElementById('all-mode');
const wrongMode = document.getElementById('wrong-mode');
const examMode = document.getElementById('exam-mode');
const examResult = document.getElementById('exam-result');
const modeLabel = document.getElementById('mode-label');
const progressLabel = document.getElementById('progress-label');
const typeLabel = document.getElementById('type-label');
const questionTitle = document.getElementById('question-title');
const answerForm = document.getElementById('answer-form');
const feedback = document.getElementById('feedback');
const answerCardSummary = document.getElementById('answer-card-summary');
const answerCardList = document.getElementById('answer-card-list');
const prevQuestion = document.getElementById('prev-question');
const submitAnswer = document.getElementById('submit-answer');
const nextQuestion = document.getElementById('next-question');
const wrongSummary = document.getElementById('wrong-summary');
const wrongList = document.getElementById('wrong-list');
const clearWrong = document.getElementById('clear-wrong');

function storageSubjectKey(prefix) {
  return `${prefix}:${currentSubject}`;
}

function loadSubject() {
  try {
    const saved = localStorage.getItem(subjectStorageKey);
    return subjectNames.includes(saved) ? saved : defaultSubject;
  } catch {
    return defaultSubject;
  }
}

function saveSubject() {
  localStorage.setItem(subjectStorageKey, currentSubject);
}

function getSubjectQuestions(subject) {
  const bank = subjectBanks[subject];
  return Array.isArray(bank) ? bank : [];
}

function loadWrongIds() {
  try {
    const legacyValue = currentSubject === defaultSubject
      ? localStorage.getItem('quiz-wrong-question-ids-v2') || localStorage.getItem('quiz-wrong-question-ids-v1')
      : null;
    const saved = JSON.parse(
      localStorage.getItem(storageSubjectKey(wrongStoragePrefix))
      || legacyValue
      || '[]',
    );
    return new Set(saved.filter((id) => Number.isInteger(id)));
  } catch {
    return new Set();
  }
}

function loadWrongCorrectStreak() {
  try {
    const legacyValue = currentSubject === defaultSubject
      ? localStorage.getItem('quiz-wrong-correct-streak-v1')
      : null;
    const saved = JSON.parse(
      localStorage.getItem(storageSubjectKey(streakStoragePrefix))
      || legacyValue
      || '{}',
    );
    return Object.fromEntries(Object.entries(saved).filter(([, value]) => Number.isInteger(value)));
  } catch {
    return {};
  }
}

function saveWrongState() {
  localStorage.setItem(storageSubjectKey(wrongStoragePrefix), JSON.stringify([...wrongIds]));
  localStorage.setItem(storageSubjectKey(streakStoragePrefix), JSON.stringify(wrongCorrectStreak));
}

function getActiveQuestions() {
  if (mode === 'wrong') return questions.filter((question) => wrongIds.has(question.id));
  if (mode === 'exam') return examQuestions;
  return questions;
}

function typeText(type) {
  if (type === 'single') return '单选题';
  if (type === 'multiple') return '多选题';
  if (type === 'judge') return '判断题';
  return '题目';
}

function isAutoSubmitQuestion(question) {
  return question.type === 'single' || question.type === 'judge';
}

function shuffle(items) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function buildExamQuestions() {
  const targetSize = Math.min(examSize, questions.length);
  const plan = examPlans[currentSubject];
  if (!plan) return shuffle(questions).slice(0, targetSize);

  const selectedByType = new Map(examTypeOrder.map((type) => [type, []]));
  const selectedIds = new Set();

  examTypeOrder.forEach((type) => {
    const available = shuffle(questions.filter((question) => question.type === type));
    const wanted = plan[type] || 0;
    const picked = available.slice(0, Math.min(wanted, available.length, targetSize - selectedIds.size));
    picked.forEach((question) => selectedIds.add(question.id));
    selectedByType.set(type, picked);
  });

  if (selectedIds.size < targetSize) {
    const remaining = shuffle(questions.filter((question) => !selectedIds.has(question.id)));
    for (const question of remaining) {
      if (selectedIds.size >= targetSize) break;
      selectedIds.add(question.id);
      const list = selectedByType.get(question.type) || [];
      list.push(question);
      selectedByType.set(question.type, list);
    }
  }

  return examTypeOrder.flatMap((type) => selectedByType.get(type) || []).slice(0, targetSize);
}

function startExam() {
  examQuestions = buildExamQuestions();
  examAnswers = new Map();
  examSubmitted = false;
  mode = 'exam';
  index = 0;
  render();
}

function formatAnswer(question) {
  return question.answer
    .map((key) => {
      const option = question.options.find((item) => item.key === key);
      return option ? `${key}. ${option.text}` : key;
    })
    .join('；');
}

function sameAnswer(userAnswer, correctAnswer) {
  if (userAnswer.length !== correctAnswer.length) return false;
  return [...userAnswer].sort().join('') === [...correctAnswer].sort().join('');
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function selectedAnswers() {
  return [...answerForm.querySelectorAll('input[name="answer"]:checked')].map((input) => input.value);
}

function practiceResultKey(question) {
  return `${mode}:${question.id}`;
}

function renderSubjectSelect() {
  subjectSelect.innerHTML = subjectNames
    .map((name) => `<option value="${escapeHtml(name)}"${name === currentSubject ? ' selected' : ''}>${escapeHtml(name)}</option>`)
    .join('');
}

function render() {
  const activeQuestions = getActiveQuestions();
  totalCount.textContent = `共 ${questions.length} 题`;
  wrongCount.textContent = `错题 ${wrongIds.size} 题`;
  allMode.classList.toggle('active', mode === 'all');
  wrongMode.classList.toggle('active', mode === 'wrong');
  examMode.classList.toggle('active', mode === 'exam');
  renderExamResult();

  if (!activeQuestions.length) {
    questionTitle.textContent = mode === 'wrong' ? '当前没有错题。' : '没有可用题目。';
    answerForm.innerHTML = '';
    modeLabel.textContent = mode === 'wrong' ? '错题练习' : mode === 'exam' ? '模拟考试' : '全部题目';
    progressLabel.textContent = '第 0 / 0 题';
    typeLabel.textContent = '-';
    feedback.className = 'feedback';
    feedback.textContent = mode === 'wrong' ? '答错的题目会自动出现在这里。' : '请检查题库数据。';
    prevQuestion.disabled = true;
    submitAnswer.disabled = true;
    nextQuestion.disabled = true;
    renderAnswerCard(activeQuestions);
    renderWrongList();
    return;
  }

  if (index >= activeQuestions.length) index = activeQuestions.length - 1;
  if (index < 0) index = 0;

  const question = activeQuestions[index];
  const savedExamAnswer = mode === 'exam' ? examAnswers.get(question.id) || [] : [];
  const allExamAnswered = mode === 'exam' && examQuestions.length > 0 && examQuestions.every((item) => (examAnswers.get(item.id) || []).length);
  const practiceResult = mode !== 'exam' ? practiceResults.get(practiceResultKey(question)) : undefined;
  answered = Boolean(practiceResult);
  modeLabel.textContent = mode === 'wrong' ? '错题练习' : mode === 'exam' ? '模拟考试' : '全部题目';
  progressLabel.textContent = `第 ${index + 1} / ${activeQuestions.length} 题`;
  typeLabel.textContent = typeText(question.type);
  questionTitle.textContent = question.question;
  feedback.className = 'feedback';
  feedback.textContent = mode === 'exam' && !examSubmitted ? '模拟考试中可用答题卡跳转，单选题和判断题选择后自动进入下一题，多选题需保存答案。' : '';
  prevQuestion.disabled = index === 0;
  submitAnswer.disabled = false;
  submitAnswer.hidden = mode === 'exam' ? isAutoSubmitQuestion(question) && !allExamAnswered : isAutoSubmitQuestion(question);
  submitAnswer.textContent = mode === 'exam' ? (allExamAnswered ? '交卷并评分' : '保存答案') : '提交多选答案';
  nextQuestion.disabled = mode !== 'exam' ? !answered : index === activeQuestions.length - 1;
  nextQuestion.textContent = mode === 'exam' && index === activeQuestions.length - 1 ? '已到最后一题' : '下一题';

  const inputType = question.type === 'multiple' ? 'checkbox' : 'radio';
  const selected = mode === 'exam' ? savedExamAnswer : practiceResult?.userAnswer || [];
  answerForm.innerHTML = question.options
    .map((option) => {
      const checked = selected.includes(option.key) ? ' checked' : '';
      const disabled = (mode === 'exam' && examSubmitted) || (mode !== 'exam' && answered) ? ' disabled' : '';
      return `
        <label class="option" data-key="${option.key}">
          <input type="${inputType}" name="answer" value="${option.key}"${checked}${disabled}>
          <span><span class="option-key">${option.key}.</span> ${escapeHtml(option.text)}</span>
        </label>
      `;
    })
    .join('');

  if (mode === 'exam' && examSubmitted) {
    showCheckedState(question, savedExamAnswer);
    const correct = sameAnswer(savedExamAnswer, question.answer);
    feedback.className = correct ? 'feedback good' : 'feedback bad';
    feedback.textContent = `${correct ? '本题正确' : '本题错误'}。正确答案：${formatAnswer(question)}`;
    submitAnswer.disabled = true;
    submitAnswer.hidden = true;
  } else if (mode !== 'exam' && practiceResult) {
    showCheckedState(question, practiceResult.userAnswer);
    feedback.className = practiceResult.correct ? 'feedback good' : 'feedback bad';
    feedback.textContent = practiceResult.message;
  }

  renderAnswerCard(activeQuestions);
  renderWrongList();
  questionTitle.focus({ preventScroll: true });
}

function showCheckedState(question, userAnswer) {
  answerForm.querySelectorAll('.option').forEach((label) => {
    const key = label.dataset.key;
    if (userAnswer.includes(key)) label.classList.add('selected');
    if (question.answer.includes(key)) label.classList.add('correct');
    if (userAnswer.includes(key) && !question.answer.includes(key)) label.classList.add('incorrect');
  });
}

function handleSubmit() {
  if (mode === 'exam') {
    const allExamAnswered = examQuestions.length > 0 && examQuestions.every((item) => (examAnswers.get(item.id) || []).length);
    if (allExamAnswered) {
      const question = examQuestions[index];
      if (question?.type === 'multiple') {
        const userAnswer = selectedAnswers();
        if (userAnswer.length) examAnswers.set(question.id, userAnswer);
        else examAnswers.delete(question.id);
      }
      finishExam();
      return;
    }
    handleExamMultipleSubmit();
    return;
  }
  submitPracticeAnswer();
}

function submitPracticeAnswer(forcedAnswer) {
  if (answered) return;
  const activeQuestions = getActiveQuestions();
  const question = activeQuestions[index];
  const userAnswer = forcedAnswer || selectedAnswers();

  if (!userAnswer.length) {
    feedback.className = 'feedback bad';
    feedback.textContent = '请先选择至少一个选项。';
    return;
  }

  answered = true;
  const correct = sameAnswer(userAnswer, question.answer);
  answerForm.querySelectorAll('input').forEach((input) => {
    input.disabled = true;
  });
  showCheckedState(question, userAnswer);

  let message = `${correct ? '回答正确' : '回答错误'}。正确答案：${formatAnswer(question)}`;
  if (correct) {
    if (mode === 'wrong') {
      wrongCorrectStreak[question.id] = (wrongCorrectStreak[question.id] || 0) + 1;
      if (wrongCorrectStreak[question.id] >= 2) {
        wrongIds.delete(question.id);
        delete wrongCorrectStreak[question.id];
        message += ' 已连续答对 2 次，本题已移出错题集。';
      } else {
        message += ` 已答对 ${wrongCorrectStreak[question.id]} 次，再答对 1 次将移出错题集。`;
      }
      saveWrongState();
    }
  } else {
    addWrongQuestion(question.id);
  }

  practiceResults.set(practiceResultKey(question), { correct, userAnswer, message });
  feedback.className = correct ? 'feedback good' : 'feedback bad';
  feedback.textContent = message;
  submitAnswer.disabled = true;
  nextQuestion.disabled = false;
  renderAnswerCard(activeQuestions);
  renderWrongList();
  wrongCount.textContent = `错题 ${wrongIds.size} 题`;
}

function handleExamMultipleSubmit() {
  if (examSubmitted) return;
  const question = examQuestions[index];
  const userAnswer = selectedAnswers();
  if (!userAnswer.length) {
    feedback.className = 'feedback bad';
    feedback.textContent = '请先选择至少一个选项。';
    return;
  }
  saveExamAnswerAndAdvance(question, userAnswer);
}

function saveExamAnswerAndAdvance(question, userAnswer) {
  examAnswers.set(question.id, userAnswer);
  if (index < examQuestions.length - 1) {
    index += 1;
    render();
    return;
  }
  render();
  feedback.className = 'feedback good';
  feedback.textContent = '最后一题答案已保存，可以交卷评分。';
}

function finishExam() {
  const unansweredIndex = examQuestions.findIndex((item) => !(examAnswers.get(item.id) || []).length);
  if (unansweredIndex >= 0) {
    index = unansweredIndex;
    render();
    feedback.className = 'feedback bad';
    feedback.textContent = `还有未答题：第 ${unansweredIndex + 1} 题。请全部作答后再交卷。`;
    return;
  }

  examSubmitted = true;
  examQuestions.forEach((question) => {
    const userAnswer = examAnswers.get(question.id) || [];
    if (!sameAnswer(userAnswer, question.answer)) addWrongQuestion(question.id);
  });
  saveWrongState();
  render();
}

function addWrongQuestion(id) {
  wrongIds.add(id);
  wrongCorrectStreak[id] = 0;
  saveWrongState();
}

function handleNext() {
  const activeQuestions = getActiveQuestions();
  if (!activeQuestions.length) {
    render();
    return;
  }
  if (mode === 'exam') {
    const question = activeQuestions[index];
    if (!examSubmitted && question.type === 'multiple') {
      const userAnswer = selectedAnswers();
      if (userAnswer.length) examAnswers.set(question.id, userAnswer);
    }
    index = Math.min(index + 1, activeQuestions.length - 1);
  } else {
    index = (index + 1) % activeQuestions.length;
  }
  render();
}

function handlePrev() {
  const activeQuestions = getActiveQuestions();
  if (!activeQuestions.length) return;
  if (mode === 'exam' && !examSubmitted) {
    const question = activeQuestions[index];
    if (question.type === 'multiple') {
      const userAnswer = selectedAnswers();
      if (userAnswer.length) examAnswers.set(question.id, userAnswer);
    }
  }
  index = Math.max(index - 1, 0);
  render();
}

function switchMode(nextMode) {
  mode = nextMode;
  index = 0;
  if (mode !== 'exam') examSubmitted = false;
  render();
}

function renderExamResult() {
  if (mode !== 'exam' || !examSubmitted) {
    examResult.hidden = true;
    examResult.innerHTML = '';
    return;
  }

  const wrong = examQuestions.filter((question) => !sameAnswer(examAnswers.get(question.id) || [], question.answer));
  const correctCount = examQuestions.length - wrong.length;
  const score = Math.round((correctCount / examQuestions.length) * 1000) / 10;
  examResult.hidden = false;
  examResult.innerHTML = `
    <h2>模拟考试成绩：${score} 分</h2>
    <p>满分 100 分。本套试题 ${examQuestions.length} 道，答对 ${correctCount} 道，答错 ${wrong.length} 道。</p>
    <p>${wrong.length ? '错题序号如下，点击可跳转查看对应题目。' : '本次模拟考试没有错题。'}</p>
    <div class="exam-jumps">
      ${wrong.map((question) => `<button type="button" data-exam-id="${question.id}">${examQuestions.indexOf(question) + 1}</button>`).join('')}
    </div>
  `;
  wrongCount.textContent = `错题 ${wrongIds.size} 题`;
}

function renderAnswerCard(activeQuestions) {
  const answeredCount = activeQuestions.filter((question) => {
    if (mode === 'exam') return Boolean((examAnswers.get(question.id) || []).length);
    return practiceResults.has(practiceResultKey(question));
  }).length;
  answerCardSummary.textContent = `已答 ${answeredCount} 题，未答 ${Math.max(0, activeQuestions.length - answeredCount)} 题`;
  answerCardList.innerHTML = activeQuestions
    .map((question, itemIndex) => {
      const classes = [];
      if (itemIndex === index) classes.push('current');
      if (mode === 'exam') {
        const userAnswer = examAnswers.get(question.id) || [];
        if (userAnswer.length) classes.push('answered');
        if (examSubmitted && userAnswer.length) classes.push(sameAnswer(userAnswer, question.answer) ? 'correct' : 'incorrect');
      } else {
        const result = practiceResults.get(practiceResultKey(question));
        if (result) classes.push(result.correct ? 'correct' : 'incorrect');
      }
      return `<button type="button" class="${classes.join(' ')}" data-card-index="${itemIndex}" aria-label="跳转到第 ${itemIndex + 1} 题">${itemIndex + 1}</button>`;
    })
    .join('');
}

function renderWrongList() {
  const wrongQuestions = questions.filter((question) => wrongIds.has(question.id));
  wrongSummary.textContent = wrongQuestions.length ? `已记录 ${wrongQuestions.length} 道错题。点击题目可进入错题练习。错题练习中同一题答对 2 次后自动移出。` : '暂无错题。';
  clearWrong.disabled = wrongQuestions.length === 0;
  wrongList.innerHTML = wrongQuestions
    .map((question) => {
      const streak = wrongCorrectStreak[question.id] || 0;
      return `
        <div class="wrong-item">
          <button type="button" data-id="${question.id}">第 ${question.id} 题：${escapeHtml(question.question)}</button>
          <small>${typeText(question.type)}，正确答案：${question.answer.join('')} <span class="wrong-progress">已连续答对 ${streak} / 2 次</span></small>
        </div>
      `;
    })
    .join('');
}

function handleSubjectChange() {
  currentSubject = subjectSelect.value;
  saveSubject();
  questions = getSubjectQuestions(currentSubject);
  wrongIds = loadWrongIds();
  wrongCorrectStreak = loadWrongCorrectStreak();
  practiceResults = new Map();
  examQuestions = [];
  examAnswers = new Map();
  examSubmitted = false;
  mode = 'all';
  index = 0;
  render();
}

subjectSelect.addEventListener('change', handleSubjectChange);
submitAnswer.addEventListener('click', handleSubmit);
nextQuestion.addEventListener('click', handleNext);
prevQuestion.addEventListener('click', handlePrev);
allMode.addEventListener('click', () => switchMode('all'));
wrongMode.addEventListener('click', () => switchMode('wrong'));
examMode.addEventListener('click', startExam);
clearWrong.addEventListener('click', () => {
  wrongIds = new Set();
  wrongCorrectStreak = {};
  saveWrongState();
  if (mode === 'wrong') index = 0;
  render();
});
answerForm.addEventListener('change', (event) => {
  const input = event.target.closest('input[name="answer"]');
  if (!input) return;
  const activeQuestions = getActiveQuestions();
  const question = activeQuestions[index];
  if (!question || !isAutoSubmitQuestion(question)) return;
  if (mode === 'exam') {
    if (examSubmitted) return;
    saveExamAnswerAndAdvance(question, [input.value]);
  } else {
    submitPracticeAnswer([input.value]);
  }
});
wrongList.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-id]');
  if (!button) return;
  const id = Number(button.dataset.id);
  const wrongQuestions = questions.filter((question) => wrongIds.has(question.id));
  const nextIndex = wrongQuestions.findIndex((question) => question.id === id);
  mode = 'wrong';
  index = Math.max(0, nextIndex);
  render();
});
answerCardList.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-card-index]');
  if (!button) return;
  if (mode === 'exam' && !examSubmitted) {
    const activeQuestions = getActiveQuestions();
    const question = activeQuestions[index];
    if (question?.type === 'multiple') {
      const userAnswer = selectedAnswers();
      if (userAnswer.length) examAnswers.set(question.id, userAnswer);
    }
  }
  index = Number(button.dataset.cardIndex);
  render();
});
examResult.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-exam-id]');
  if (!button) return;
  const id = Number(button.dataset.examId);
  const nextIndex = examQuestions.findIndex((question) => question.id === id);
  if (nextIndex >= 0) {
    index = nextIndex;
    render();
  }
});

renderSubjectSelect();
render();
