const PDFJS_VERSION = '4.10.38';
const PDF_URL = './ilovepdf_merged.pdf';
const pdfjsPromise = import(`https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VERSION}/build/pdf.min.mjs`);

const $ = (selector) => document.querySelector(selector);
const elements = {
  status: $('#book-status'), title: $('#book-title'), count: $('#topic-count'), nav: $('#topic-nav'),
  loading: $('#loading'), progress: $('#progress-bar'), progressLabel: $('#progress-label'),
  error: $('#error-panel'), errorMessage: $('#error-message'), welcome: $('#welcome'),
  heading: $('#topic-heading'), intro: $('#topic-intro'), kicker: $('#chapter-kicker'), lesson: $('#lesson-content'),
  points: $('#key-points'), quiz: $('#quiz-list'), score: $('#quiz-score'),
  upload: $('#pdf-upload'), choose: $('#choose-pdf')
};
let topics = [];
let activeTopic = 0;
let currentPdfName = 'Your book';

const stopWords = new Set(('about above after again against all also am an and any are as at be because been before being between both but by can could did do does doing down during each few for from further had has have having he her here hers herself him himself his how i if in into is it its itself just me more most my myself no nor not of off on once only or other our ours ourselves out over own same she should so some such than that the their theirs them themselves then there these they this those through to too under until up very was we were what when where which while who whom why will with would you your yours').split(' '));
const answerBlacklist = new Set(['about','above','after','again','against','also','among','because','before','being','between','could','during','every','first','from','having','however','itself','other','should','their','there','these','those','through','under','where','which','while','would','using','used','based','often','known','called','means','make','made','many','much','more','most','some','such','than','then','them','they','this','that','what','when','were','with','within','without']);

function cleanText(text) {
  return text.replace(/\u00ad/g, '').replace(/[\u200b\ufeff]/g, '').replace(/[ \t]+/g, ' ').replace(/\s+([,.;:!?])/g, '$1').trim();
}
function escapeHTML(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
}
function showError(message) {
  elements.loading.hidden = true;
  elements.welcome.hidden = true;
  elements.error.hidden = false;
  elements.errorMessage.textContent = message;
  elements.status.textContent = 'PDF not loaded';
  elements.status.previousElementSibling.classList.add('status-error');
}
function setProgress(done, total) {
  const percent = total ? Math.round((done / total) * 100) : 0;
  elements.progress.style.width = `${percent}%`;
  elements.progressLabel.textContent = total ? `Reading your pages · ${done} of ${total}` : 'Opening PDF…';
}

// PDF.js exposes font sizes and positions. They help distinguish chapter headings
// from paragraphs while keeping all lesson text tied to the source document.
async function readPdf(data, name) {
  elements.error.hidden = true;
  elements.welcome.hidden = true;
  elements.loading.hidden = false;
  elements.status.textContent = 'Reading your book…';
  elements.title.textContent = name.replace(/\.pdf$/i, '');
  currentPdfName = name.replace(/\.pdf$/i, '') || 'Your book';
  elements.progress.style.width = '4%';
  elements.progressLabel.textContent = 'Opening PDF…';
  const pdfjsLib = await pdfjsPromise;
  pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VERSION}/build/pdf.worker.min.mjs`;
  const pdf = await pdfjsLib.getDocument({data}).promise;
  const pages = [];
  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum += 1) {
    const page = await pdf.getPage(pageNum);
    const content = await page.getTextContent();
    const lines = groupPageLines(content.items);
    pages.push({pageNum, lines});
    setProgress(pageNum, pdf.numPages);
  }
  topics = makeTopics(pages, pdf.numPages);
  if (!topics.length) throw new Error('No readable text was found. This PDF may contain scanned images rather than selectable text.');
  elements.title.textContent = currentPdfName;
  elements.count.textContent = `${topics.length} ${topics.length === 1 ? 'topic' : 'topics'} · ${pdf.numPages} pages`;
  elements.status.textContent = 'Your study guide is ready';
  elements.status.previousElementSibling.classList.remove('status-error');
  renderNavigation();
  elements.loading.hidden = true;
  elements.welcome.hidden = false;
  openTopic(0);
}

function groupPageLines(items) {
  const rows = new Map();
  for (const item of items) {
    if (!item.str || !item.str.trim()) continue;
    const y = Math.round(item.transform?.[5] || 0);
    const size = Math.round((item.height || item.transform?.[0] || 10) * 10) / 10;
    const row = rows.get(y) || {parts: [], sizes: []};
    row.parts.push({x: item.transform?.[4] || 0, text: item.str});
    row.sizes.push(size);
    rows.set(y, row);
  }
  return [...rows.entries()].map(([y, row]) => ({
    y,
    text: cleanText(row.parts.sort((a,b) => a.x - b.x).map(part => part.text).join(' ')),
    size: row.sizes.length ? Math.max(...row.sizes) : 10
  })).filter(line => line.text.length > 1).sort((a,b) => b.y - a.y);
}

function isHeading(line, pageMedian, previousLine) {
  const text = line.text;
  if (text.length < 3 || text.length > 115) return false;
  if (/^(chapter|unit|part|section|lesson|module)\s+([\divx]+|[\w-]+)/i.test(text)) return true;
  if (/^\d+(?:\.\d+){0,3}[.)]?\s+\S/.test(text)) return true;
  const words = text.split(/\s+/);
  const titleLike = words.length <= 12 && words.every(word => /^[A-Z0-9][A-Za-z0-9’'&()/-]*$/.test(word));
  const significantlyLarger = line.size >= pageMedian * 1.22 && line.size >= 12;
  const isolated = !previousLine || (previousLine.y - line.y > 17);
  return (significantlyLarger && (isolated || titleLike)) || (titleLike && isolated && line.size >= pageMedian * 1.05);
}

function makeTopics(pages, pageCount) {
  const collected = [];
  const pageInfo = pages.map(page => {
    const sizes = page.lines.map(line => line.size).filter(size => size > 0);
    const median = sizes.length ? sizes.sort((a,b)=>a-b)[Math.floor(sizes.length/2)] : 10;
    return {...page, median};
  });
  let current = null;
  for (const page of pageInfo) {
    let previous = null;
    for (const line of page.lines) {
      if (isHeading(line, page.median, previous)) {
        const normalized = normalizeHeading(line.text);
        if (current && current.title.toLowerCase() === normalized.toLowerCase()) {
          previous = line;
          continue;
        }
        current = {title: normalized, paragraphs: [], pages: new Set([page.pageNum]), sourceHeading: true};
        collected.push(current);
      } else if (line.text.length > 3) {
        if (!current) {
          current = {title: 'Getting started', paragraphs: [], pages: new Set(), sourceHeading: false};
          collected.push(current);
        }
        current.paragraphs.push({text: line.text, page: page.pageNum});
        current.pages.add(page.pageNum);
      }
      previous = line;
    }
  }
  const useful = collected.filter(topic => topic.paragraphs.length > 0);
  const large = useful.filter(topic => topic.paragraphs.reduce((sum,p)=>sum+p.text.length,0) >= 180);
  const selected = large.length >= 2 ? large : useful;
  let result = selected.map(topic => ({...topic, pages: [...topic.pages], paragraphs: joinParagraphs(topic.paragraphs)}));
  result = result.filter(topic => topic.paragraphs.length);
  // When the PDF has no reliable chapter typography, keep every passage in
  // page-order chunks rather than inventing topic names not found in the book.
  if (!result.some(topic => topic.sourceHeading) && result.length > 0) {
    const all = result.flatMap(topic => topic.paragraphs.map(p => ({text:p.text,page:p.page})));
    const perChunk = Math.max(12, Math.ceil(all.length / Math.max(1, Math.min(12, Math.ceil(pageCount / 3)))));
    const chunks = [];
    for (let i=0; i<all.length; i+=perChunk) {
      const section = all.slice(i, i+perChunk);
      chunks.push({title:`Reading ${chunks.length + 1}`, paragraphs:joinParagraphs(section), pages:[...new Set(section.map(p=>p.page))], sourceHeading:false});
    }
    result = chunks;
  }
  return result.map((topic, index) => ({...topic, id:`topic-${index}`}));
}
function normalizeHeading(text) {
  return text.replace(/\s+/g,' ').replace(/^[\W_]+|[\W_]+$/g,'').trim() || 'Untitled topic';
}
function joinParagraphs(lines) {
  const paragraphs = [];
  let current = '';
  let previousPage = 0;
  for (const line of lines) {
    const next = cleanText(line.text);
    if (!next) continue;
    const hasSentenceEnd = /[.!?:;]["')\]]?$/.test(current);
    const pageChanged = previousPage && line.page !== previousPage;
    if (current && (hasSentenceEnd || pageChanged || current.length > 560)) {
      paragraphs.push({text:current.trim(),page:previousPage});
      current = '';
    }
    if (current && /[a-z]$/.test(current) && /^[a-z]/.test(next)) current = current.slice(0,-1) + next;
    else current += (current ? ' ' : '') + next;
    previousPage = line.page;
  }
  if (current.trim()) paragraphs.push({text:current.trim(),page:previousPage});
  return paragraphs.filter(p=>p.text.length > 18);
}

function renderNavigation() {
  elements.nav.innerHTML = topics.map((topic,index) => `<button class="topic-link${index === activeTopic ? ' active' : ''}" data-topic="${index}" type="button"><span class="topic-number">${String(index+1).padStart(2,'0')}</span><span class="topic-link-text">${escapeHTML(topic.title)}</span><span class="nav-arrow">↗</span></button>`).join('');
  elements.nav.querySelectorAll('[data-topic]').forEach(button => button.addEventListener('click', () => openTopic(Number(button.dataset.topic))));
}
function openTopic(index) {
  if (!topics[index]) return;
  activeTopic = index;
  const topic = topics[index];
  elements.heading.textContent = topic.title;
  elements.kicker.textContent = `TOPIC ${String(index+1).padStart(2,'0')}  /  ${String(topics.length).padStart(2,'0')}`;
  const firstText = topic.paragraphs.map(p=>p.text).join(' ');
  elements.intro.textContent = makeIntro(firstText, topic);
  elements.lesson.innerHTML = topic.paragraphs.map(p => `<p>${escapeHTML(p.text)} <span class="page-ref">p. ${p.page}</span></p>`).join('');
  const points = extractKeyPoints(topic.paragraphs);
  elements.points.hidden = !points.length;
  elements.points.innerHTML = points.length ? `<h3>Keep these ideas in mind</h3><ul>${points.map(point=>`<li>${escapeHTML(point.text)} <span class="page-ref">p. ${point.page}</span></li>`).join('')}</ul>` : '';
  renderQuiz(topic, index);
  elements.nav.querySelectorAll('.topic-link').forEach((button,i)=>button.classList.toggle('active',i===index));
  elements.nav.querySelector(`[data-topic="${index}"]`)?.scrollIntoView({block:'nearest',behavior:'smooth'});
  window.scrollTo({top:0,behavior:'smooth'});
}
function makeIntro(text, topic) {
  if (!topic.sourceHeading) return 'This section is grouped from the book’s text because the PDF does not provide clear chapter headings. Read the original passages below, then check what you remember with questions drawn from them.';
  const sentence = text.match(/[^.!?]+[.!?]+/);
  if (sentence && sentence[0].trim().length > 45) return `Start with the book’s key idea: “${sentence[0].trim().slice(0,200)}${sentence[0].trim().length > 200 ? '…' : ''}” The full explanation and its context are below.`;
  return `Read the explanation below for “${topic.title}.” It preserves the wording and context from your book, with page references to help you review.`;
}
function extractKeyPoints(paragraphs) {
  const sentences = paragraphs.flatMap(p => p.text.match(/[^.!?]+[.!?]+|[^.!?]+$/g)?.map(text=>({text:text.trim(),page:p.page})) || []);
  const selected = sentences.filter(item => item.text.length >= 65 && item.text.length <= 260 && !/^\d+$/.test(item.text));
  const out=[]; const seen=new Set();
  for (const item of selected) {
    const key=item.text.toLowerCase().replace(/\W/g,'').slice(0,70);
    if (!seen.has(key)) { out.push(item); seen.add(key); }
    if (out.length===3) break;
  }
  return out;
}
function extractCandidate(sentence) {
  const words = sentence.match(/[A-Za-z][A-Za-z'-]{3,}/g) || [];
  const counts = new Map();
  for (const raw of words) {
    const word=raw.replace(/[’']/g,''); const key=word.toLowerCase();
    if (stopWords.has(key)||answerBlacklist.has(key)||word.length<4) continue;
    counts.set(word,(counts.get(word)||0)+1);
  }
  const unique=[...counts].filter(([,n])=>n===1).map(([word])=>word);
  return unique.sort((a,b)=>b.length-a.length)[0] || null;
}
function splitSentences(paragraphs) {
  return paragraphs.flatMap(paragraph => (paragraph.text.match(/[^.!?]+[.!?]+|[^.!?]+$/g)||[]).map(text=>({text:text.trim(),page:paragraph.page})));
}
function getQuestions(topic) {
  const sentences=splitSentences(topic.paragraphs).filter(item=>item.text.length>=48&&item.text.length<=300&&/[A-Za-z]{4}/.test(item.text));
  const candidates=[]; const seen=new Set();
  for (const item of sentences) {
    const answer=extractCandidate(item.text);
    if (!answer) continue;
    const normalized=item.text.toLowerCase().replace(/\W/g,'');
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    candidates.push({...item,answer});
  }
  // Prefer sentences with enough unique subject vocabulary to make fair choices.
  return candidates.slice(0,3);
}
function makeOptions(correct, topic, questionIndex) {
  const correctKey=correct.toLowerCase();
  const words=topic.paragraphs.flatMap(p=>p.text.match(/[A-Za-z][A-Za-z'-]{3,}/g)||[]);
  const pool=[...new Set(words.filter(word=>!stopWords.has(word.toLowerCase())&&!answerBlacklist.has(word.toLowerCase())&&word.toLowerCase()!==correctKey&&word.length>=4))];
  // Prioritize words similar in length, then deterministically vary the options by question.
  const distractors=pool.sort((a,b)=>Math.abs(a.length-correct.length)-Math.abs(b.length-correct.length)||a.localeCompare(b)).slice(questionIndex*2,questionIndex*2+8);
  const options=[correct,...distractors.slice(0,3)];
  for (const fallback of ['concept','process','system','method','result','example','pattern']) {
    if(options.length>=4) break;
    if(!options.some(word=>word.toLowerCase()===fallback)&&fallback!==correctKey) options.push(fallback);
  }
  return options.sort((a,b)=>a.localeCompare(b));
}
function renderQuiz(topic, topicIndex) {
  const questions=getQuestions(topic);
  elements.score.hidden=true;
  elements.score.textContent='';
  if (!questions.length) {
    elements.quiz.innerHTML='<div class="empty-quiz"><span>✳</span><div><strong>Read through this section first.</strong><p>There is not enough selectable text here to make a fair multiple-choice question. Your lesson above still includes the available PDF text.</p></div></div>';
    return;
  }
  elements.quiz.innerHTML=questions.map((question,index)=>{
    const options=makeOptions(question.answer,topic,index);
    const marked=question.text.replace(new RegExp(`\\b${escapeRegExp(question.answer)}\\b`,'i'),'________');
    return `<article class="question-card" data-question="${index}"><div class="question-meta"><span>QUESTION ${String(index+1).padStart(2,'0')}</span><span>FROM ${escapeHTML(topic.title)}</span></div><h3>${escapeHTML(marked)}</h3><div class="answer-options">${options.map((option,optionIndex)=>`<button class="answer-option" type="button" data-option="${escapeHTML(option)}"><span class="option-letter">${String.fromCharCode(65+optionIndex)}</span><span>${escapeHTML(option)}</span></button>`).join('')}</div><div class="answer-feedback" hidden></div></article>`;
  }).join('');
  const cards=[...elements.quiz.querySelectorAll('.question-card')];
  cards.forEach((card,index)=>{
    const question=questions[index];
    const buttons=[...card.querySelectorAll('.answer-option')];
    const feedback=card.querySelector('.answer-feedback');
    buttons.forEach(button=>button.addEventListener('click',()=>{
      if(card.dataset.answered) return;
      card.dataset.answered='true';
      const correct=button.dataset.option.toLowerCase()===question.answer.toLowerCase();
      button.classList.add(correct?'correct':'incorrect');
      buttons.forEach(item=>{item.disabled=true;if(item.dataset.option.toLowerCase()===question.answer.toLowerCase())item.classList.add('correct');});
      feedback.hidden=false;
      feedback.className=`answer-feedback ${correct?'feedback-correct':'feedback-incorrect'}`;
      feedback.innerHTML=`<strong>${correct?'That’s right.':'Not quite — the answer is '+escapeHTML(question.answer)+'.'}</strong><p>${escapeHTML(question.text)} <span class="page-ref">p. ${question.page}</span></p>`;
      const answered=cards.filter(item=>item.dataset.answered).length;
      const score=cards.filter(item=>item.querySelector('.answer-option.correct')?.classList.contains('selected')).length;
      // Record the user's original selection separately from the revealed answer.
      if(correct) button.classList.add('selected');
      const finalScore=cards.filter(item=>item.querySelector('.answer-option.selected')).length;
      elements.score.hidden=false;
      elements.score.textContent=answered===cards.length?`${finalScore} / ${cards.length} correct`:`${answered} / ${cards.length} answered`;
    }));
  });
}
function escapeRegExp(text) { return text.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'); }

async function loadDefaultPdf() {
  try {
    const response=await fetch(PDF_URL);
    if(!response.ok) throw new Error(`The PDF request returned ${response.status}.`);
    await readPdf(new Uint8Array(await response.arrayBuffer()),'ilovepdf_merged.pdf');
  } catch(error) {
    showError(`${error.message} Choose the PDF from your device, or open this website through its hosted address (not by opening index.html directly).`);
  }
}
function choosePdf() { elements.upload.click(); }
elements.choose.addEventListener('click',choosePdf);
$('#error-choose').addEventListener('click',choosePdf);
elements.upload.addEventListener('change',async event=>{
  const file=event.target.files?.[0];
  if(!file) return;
  try { await readPdf(new Uint8Array(await file.arrayBuffer()),file.name); }
  catch(error) { showError(`${error.message} If the PDF is a scan, try an OCR-readable or text-selectable version.`); }
  event.target.value='';
});
loadDefaultPdf();
