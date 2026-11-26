// @ts-nocheck
/// <reference types="jquery" />
/// <reference types="toastr" />

import * as Script from '../../../../script.js';
import { callPopup, characters, eventSource, event_types, getRequestHeaders, saveSettingsDebounced, substituteParams, this_chid } from '../../../../script.js';
import { extension_settings, getContext } from '../../../extensions.js';
import { selected_group } from '../../../group-chats.js';
import { download, uuidv4, getFileText } from '../../../utils.js';
import { ARGUMENT_TYPE, SlashCommandArgument, SlashCommandNamedArgument } from '../../../slash-commands/SlashCommandArgument.js';
import { SlashCommandParser } from '../../../slash-commands/SlashCommandParser.js';
import { SlashCommand } from '../../../slash-commands/SlashCommand.js';

/**
 * 모듈 이름 / 버전
 */
const MODULE_NAME = 'character-assets';
const VERSION = '1.3.0';
const EXTENSION_BASE = new URL('.', import.meta.url).pathname;

const ALLOWED_EXTENSIONS = ['png', 'webp', 'gif', 'jpg', 'jpeg'];
const ALLOWED_MIME = ['image/png', 'image/webp', 'image/gif', 'image/jpeg'];
const IMG_TAG_REGEX = /\{\{img::([^}]+?)\}\}/gi;
const CODE_WRAPPED_TAG_REGEX = /<code>\s*(\{\{img::[^}]+?\}\})\s*<\/code>/gi;
const INJECT_KEY = 'character_assets_image_prompt';
const PERSONA_OWNER = '__persona__';
const UPLOAD_CONCURRENCY = 3;

/**
 * 기본 이미지 출력 프롬프트
 */
const DEFAULT_IMAGE_PROMPT = `### Prompt Instruction for Image Tag Insertion (Custom Format Version)

When processing the text, insert up to 2 internal image tags per response, placed between paragraphs (i.e., after a full paragraph has ended). Follow these guidelines precisely:

1. Tag Format:
   Always use the format \`{{img::keyword.extension}}\` — this is a custom tag format used specifically for internal assets.
   - You must include the correct file extension (e.g., \`.jpg\`, \`.png\`, \`.webp\`, etc.) as part of the filename.
   - Do NOT use standard HTML tags like \`<img src="...">\` — those are reserved for external images.
   - Example (correct): \`{{img::steampunk_city.jpg}}\`
   - Incorrect: \`<img src="steampunk_city.jpg">\`

2. Placement Limitation:
   - Insert no more than 2 image tags per response.
   - Insert only if the image enhances the reader's understanding, mood, or emotional tone of the paragraph.
   - Each tag must be placed after a full paragraph ends, not mid-sentence.

3. Context Matching:
   Evaluate the content of each paragraph.
   If a keyword from the list clearly matches the subject, tone, or setting, insert the corresponding image tag after that paragraph.
   - If no keyword fits the context, skip insertion.

4. Avoiding Repetition:
   - Do not repeat the same keyword multiple times across recent responses.
   - Rotate and diversify your choices whenever possible.

5. Syntax Handling:
   This system does not support HTML \`<img>\` tags for internal image rendering.
   Only use \`{{img::filename.ext}}\` format for internal images.
   External images (e.g., from \`https://\` URLs) must continue to use \`<img src="...">\`.

6. Keyword List:
The available keywords are: \`{{img_keywords_grouped}}\`
(Full list with extensions: \`{{img_keywords_autogen}}\`)
- Use only the exact filenames and extensions from the list.
- Do not guess, invent, or modify extensions or filenames.
`;

/**
 * 기본 프리셋 이름
 */
const DEFAULT_PRESET_NAME = '기본 프리셋';

const DEFAULT_PRESETS = [
    {
        name: DEFAULT_PRESET_NAME,
        prompt: DEFAULT_IMAGE_PROMPT
    },
    {
        name: '1:1 감정/표정형',
        prompt: `### Character Asset Direction

Use internal image tags to emphasize the character's emotional state in a 1:1 chat.

- Insert at most 1 image tag per response.
- Place it after a complete paragraph, never inside a sentence.
- Prefer expressions, gestures, outfits, or close-up mood images.
- Use only exact filenames from this list: {{img_keywords_autogen}}
- Format: {{img::filename.ext}}
- If no image clearly fits, do not insert a tag.`
    },
    {
        name: '시뮬레이션/장소·아이템형',
        prompt: `### Simulation Asset Direction

Use internal image tags as scene, location, item, UI, or event illustrations for simulation-style play.

- Insert up to 2 image tags per response when they clarify the scene or state change.
- Place each tag after a full paragraph.
- Prioritize locations, important items, maps, status screens, CGs, and major event images.
- Use only exact filenames from this list: {{img_keywords_autogen}}
- Format: {{img::filename.ext}}
- If no image is relevant, skip image insertion.`
    }
];

/**
 * 정규식 기본값
 */
const DEFAULT_REGEX_FIND = '(?<!\\\\)!\\[([^\\[\\]]+)\\]\\(([^\\(\\)]+)\\)';
const DEFAULT_REGEX_REPLACE = '<div style="display:inline-block; text-align:center; margin: 5px 0;"><img onerror="this.src=\\\'../img/notfound.webp\\\'" class="character_asset" src="$2" /><br /><span style="font-size: 0.8em; opacity: 0.5;">$1</span></div>';


/**
 * 채팅 속 그림 틀.
 * 틀 크기는 최대 너비의 1%(--u) 단위로 잡아서, 크기를 바꿔도 비율이 그대로 유지된다.
 * 내장 렌더러와 Regex 다운로드가 같은 CSS를 쓰도록 여기 한 곳에 둔다.
 */
const RENDER_STYLES = [
    { id: 'plain', name: '그대로', desc: '꾸밈 없이' },
    { id: 'ink', name: '가는 선', desc: '여백과 선 한 줄' },
    { id: 'print', name: '인화 사진', desc: '흰 인화지 테두리' },
    { id: 'polaroid', name: '폴라로이드', desc: '아래 여백 · 살짝 기울임' },
    { id: 'tape', name: '마스킹테이프', desc: '테이프로 붙인 사진' },
    { id: 'corner', name: '사진 모서리', desc: '앨범에 끼운 모습' },
    { id: 'stamp', name: '우표', desc: '톱니 가장자리' },
    { id: 'film', name: '필름', desc: '구멍 뚫린 필름 띠' },
    { id: 'shadow', name: '떠 있는', desc: '부드러운 그림자' },
    { id: 'float-left', name: '글 왼쪽', desc: '글이 오른쪽으로 감싸요' },
    { id: 'float-right', name: '글 오른쪽', desc: '글이 왼쪽으로 감싸요' },
];

const DEFAULT_RENDER_STYLE = 'ink';

/** 예전 스타일 이름 → 지금 틀 */
const LEGACY_STYLE_MAP = {
    default: 'plain',
    border: 'ink',
    clean: 'plain',
    vignette: 'shadow',
    cinema: 'film',
};

const FRAME_BASE_CSS = `
.ca-asset {
    --u: calc(var(--ca-asset-max, 400px) / 100);
    display: block;
    margin: 1.1em 0;
    padding: 0;
    line-height: 0;
    text-align: center;
}
.ca-asset img.character-asset-rendered {
    position: relative;
    display: inline-block;
    box-sizing: border-box;
    width: auto;
    height: auto;
    max-width: min(100%, var(--ca-asset-max, 400px));
    max-height: min(85vh, calc(var(--ca-asset-max, 400px) * 2));
    margin: 0;
    border: 0;
    object-fit: contain;
    vertical-align: top;
}
.ca-asset .ca-asset__cap {
    display: block;
    margin-top: 0.6em;
    font-size: 0.78em;
    line-height: 1.4;
    opacity: 0.62;
    word-break: break-all;
}
.ca-asset.is-zoomable img.character-asset-rendered {
    cursor: zoom-in;
}
`;

const FRAME_STYLE_CSS = {
    plain: `
.ca-as-plain img.character-asset-rendered {
    border-radius: 2px;
}`,
    ink: `
.ca-as-ink img.character-asset-rendered {
    padding: calc(var(--u) * 1.6);
    border: 1px solid var(--SmartThemeBodyColor, currentColor);
    background: var(--SmartThemeBlurTintColor, transparent);
}`,
    print: `
.ca-as-print img.character-asset-rendered {
    padding: calc(var(--u) * 2.2);
    background: #fff;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.14), 0 calc(var(--u) * 1.5) calc(var(--u) * 5) rgba(0, 0, 0, 0.13);
}`,
    polaroid: `
.ca-as-polaroid {
    padding: calc(var(--u) * 1.5) 0;
}
.ca-as-polaroid img.character-asset-rendered {
    max-width: min(100%, calc(var(--ca-asset-max, 400px) * 0.9));
    padding: calc(var(--u) * 2.4) calc(var(--u) * 2.4) calc(var(--u) * 11);
    background: #fff;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.14), 0 calc(var(--u) * 2) calc(var(--u) * 6) rgba(0, 0, 0, 0.16);
    transform: rotate(-1.6deg);
}`,
    tape: `
.ca-asset.ca-as-tape {
    position: relative;
    display: table;
    max-width: 100%;
    margin: 1.3em auto;
}
.ca-as-tape img.character-asset-rendered {
    padding: calc(var(--u) * 2.2);
    background: #fff;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.14), 0 calc(var(--u) * 1.5) calc(var(--u) * 5) rgba(0, 0, 0, 0.13);
}
.ca-as-tape::before {
    content: "";
    position: absolute;
    z-index: 1;
    top: calc(var(--u) * -2.6);
    left: 50%;
    width: calc(var(--u) * 24);
    height: calc(var(--u) * 6.4);
    margin-left: calc(var(--u) * -12);
    background: color-mix(in srgb, var(--ca-tape, #f0a3bd) 42%, transparent);
    box-shadow: 0 1px 1px rgba(0, 0, 0, 0.08);
    transform: rotate(-2deg);
}`,
    corner: `
.ca-asset.ca-as-corner {
    position: relative;
    display: table;
    max-width: 100%;
    margin: 1.3em auto;
    padding: calc(var(--u) * 1.4);
}
.ca-as-corner::before,
.ca-as-corner::after {
    content: "";
    position: absolute;
    z-index: 1;
    inset: 0;
    pointer-events: none;
    --c: var(--SmartThemeBodyColor, #444);
    --k: calc(var(--u) * 7);
}
.ca-as-corner::before {
    background:
        linear-gradient(135deg, var(--c) 50%, transparent 50%) left top / var(--k) var(--k) no-repeat,
        linear-gradient(225deg, var(--c) 50%, transparent 50%) right top / var(--k) var(--k) no-repeat;
}
.ca-as-corner::after {
    background:
        linear-gradient(45deg, var(--c) 50%, transparent 50%) left bottom / var(--k) var(--k) no-repeat,
        linear-gradient(315deg, var(--c) 50%, transparent 50%) right bottom / var(--k) var(--k) no-repeat;
}
.ca-as-corner img.character-asset-rendered {
    display: block;
}`,
    stamp: `
.ca-asset.ca-as-stamp {
    --d: calc(var(--u) * 3.2);
    position: relative;
    display: table;
    max-width: 100%;
    margin: 1.3em auto;
    padding: calc(var(--u) * 3.4);
    background: #fff;
    filter: drop-shadow(0 var(--u) calc(var(--u) * 2.4) rgba(0, 0, 0, 0.2));
    -webkit-mask:
        radial-gradient(circle at center, transparent calc(var(--d) * 0.32), #000 calc(var(--d) * 0.34)) calc(var(--d) / -2) calc(var(--d) / -2) / var(--d) var(--d),
        linear-gradient(#000 0 0) center / calc(100% - var(--d)) calc(100% - var(--d)) no-repeat;
    mask:
        radial-gradient(circle at center, transparent calc(var(--d) * 0.32), #000 calc(var(--d) * 0.34)) calc(var(--d) / -2) calc(var(--d) / -2) / var(--d) var(--d),
        linear-gradient(#000 0 0) center / calc(100% - var(--d)) calc(100% - var(--d)) no-repeat;
}
.ca-as-stamp img.character-asset-rendered {
    display: block;
    outline: 1px solid rgba(0, 0, 0, 0.18);
    outline-offset: calc(var(--u) * 0.8);
}
.ca-as-stamp .ca-asset__cap {
    color: #4b4b52;
}`,
    film: `
.ca-asset.ca-as-film {
    --hole: calc(var(--u) * 2.6);
    position: relative;
    display: table;
    max-width: 100%;
    margin: 1.3em auto;
    padding: calc(var(--u) * 6.5) calc(var(--u) * 2);
    background: #15151a;
}
.ca-as-film::before,
.ca-as-film::after {
    content: "";
    position: absolute;
    right: calc(var(--u) * 2);
    left: calc(var(--u) * 2);
    height: var(--hole);
    border-radius: 1px;
    background: repeating-linear-gradient(90deg, #f4f4f6 0 calc(var(--hole) * 1.2), transparent calc(var(--hole) * 1.2) calc(var(--hole) * 2.6));
    opacity: 0.92;
}
.ca-as-film::before {
    top: calc(var(--u) * 2);
}
.ca-as-film::after {
    bottom: calc(var(--u) * 2);
}
.ca-as-film img.character-asset-rendered {
    display: block;
}
.ca-as-film .ca-asset__cap {
    color: #e6e6ea;
}`,
    shadow: `
.ca-as-shadow img.character-asset-rendered {
    border-radius: 3px;
    box-shadow: 0 calc(var(--u) * 3) calc(var(--u) * 9) rgba(0, 0, 0, 0.22), 0 1px 3px rgba(0, 0, 0, 0.12);
}`,
    'float-left': `
.ca-asset.ca-as-float-left {
    float: left;
    max-width: 50%;
    margin: 0.3em 1.1em 0.6em 0;
}
.ca-as-float-left img.character-asset-rendered {
    max-width: min(100%, calc(var(--ca-asset-max, 400px) * 0.45));
    max-height: calc(var(--ca-asset-max, 400px) * 0.65);
    padding: calc(var(--u) * 1.2);
    background: #fff;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.14), 0 calc(var(--u) * 1.5) calc(var(--u) * 5) rgba(0, 0, 0, 0.13);
}`,
    'float-right': `
.ca-asset.ca-as-float-right {
    float: right;
    max-width: 50%;
    margin: 0.3em 0 0.6em 1.1em;
}
.ca-as-float-right img.character-asset-rendered {
    max-width: min(100%, calc(var(--ca-asset-max, 400px) * 0.45));
    max-height: calc(var(--ca-asset-max, 400px) * 0.65);
    padding: calc(var(--u) * 1.2);
    background: #fff;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.14), 0 calc(var(--u) * 1.5) calc(var(--u) * 5) rgba(0, 0, 0, 0.13);
}`,
};

function injectFrameStyles() {
    let tag = document.getElementById('character_assets_frames');
    if (!tag) {
        tag = document.createElement('style');
        tag.id = 'character_assets_frames';
        document.head.appendChild(tag);
    }
    tag.textContent = FRAME_BASE_CSS + Object.values(FRAME_STYLE_CSS).join('\n');
}

/** 예전 Regex 방식용 템플릿 (내장 렌더러와 같은 틀) */
function getRegexTemplate(styleId) {
    const style = RENDER_STYLES.find(item => item.id === styleId);
    if (!style) return null;
    return {
        id: style.id,
        name: style.name,
        find: '/\\{\\{img::(.*?)\\}\\}/gi',
        replace: `<style>${FRAME_BASE_CSS}${FRAME_STYLE_CSS[style.id]}\n</style>\n<span class="ca-asset ca-as-${style.id}"><img class="character-asset-rendered" src="/characters/{{charkey}}/$1" alt="$1"></span>`,
    };
}

const ACCENTS = [
    { id: 'rose', name: '로즈', color: '#f0a3bd' },
    { id: 'lavender', name: '라벤더', color: '#bca9f5' },
    { id: 'peach', name: '피치', color: '#f5b592' },
    { id: 'mint', name: '민트', color: '#8ed8bf' },
    { id: 'sky', name: '스카이', color: '#96c4f2' },
    { id: 'theme', name: '테마 색', color: 'var(--SmartThemeQuoteColor, #e18a24)' },
];

const MACRO_DOCS = [
    { macro: '{{img_inprompt}}', desc: '이미지 지침 전체가 이 자리에 들어가요.', chip: false },
    { macro: '{{img_keywords_grouped}}', desc: '묶음 키워드 목록. 예: angry_[1, 2], happy', chip: true },
    { macro: '{{img_keywords_autogen}}', desc: '켜진 파일명 목록 (확장자 포함, 자동 갱신)', chip: true },
    { macro: '{{img_keywords}}', desc: '켜진 키워드 목록 (확장자 없이)', chip: true },
    { macro: '{{img_count}}', desc: '켜진 에셋 개수', chip: true },
    { macro: '{{charkey}}', desc: '실제 에셋 폴더 경로 (링크·버전 반영)', chip: true },
    { macro: '{{img_rand::키워드}}', desc: '키워드로 시작하는 에셋 중 하나의 주소', chip: true },
    { macro: '{{img_resolve::이름}}', desc: '이름에 맞는 에셋 주소', chip: true },
];

/**
 * 비슷한 이름 자동 연결에 쓰는 표정/상황 단어 묶음.
 * 같은 줄에 있는 단어끼리는 같은 뜻으로 본다. (첫 단어가 대표)
 */
const SYNONYM_GROUPS = [
    ['happy', 'joy', 'joyful', 'glad', 'smile', 'smiling', 'cheerful', 'pleased', '기쁨', '기쁜', '행복', '행복한', '웃음', '웃는', '미소', '즐거움', '嬉しい', '笑顔', '喜び'],
    ['laugh', 'laughing', 'lol', 'giggle', 'giggling', '폭소', '깔깔', '빵터짐', '笑う'],
    ['sad', 'sadness', 'sorrow', 'unhappy', 'gloomy', 'depressed', '슬픔', '슬픈', '우울', '우울한', '시무룩', '悲しい'],
    ['cry', 'crying', 'tears', 'tearful', 'sob', 'sobbing', '울음', '우는', '눈물', '泣く', '涙'],
    ['angry', 'anger', 'mad', 'furious', 'rage', 'annoyed', 'irritated', '화남', '화난', '분노', '짜증', '빡침', '怒り', '怒る'],
    ['surprised', 'surprise', 'shock', 'shocked', 'astonished', 'startled', 'amazed', '놀람', '놀란', '깜짝', '驚き'],
    ['embarrassed', 'shy', 'blush', 'blushing', 'flustered', 'bashful', '부끄러움', '부끄러운', '수줍음', '수줍은', '홍조', '쑥스러움', '당황', '照れ', '恥ずかしい'],
    ['love', 'loving', 'affection', 'adoring', 'lovestruck', '사랑', '설렘', '두근', '애정', '好き', '恋'],
    ['scared', 'fear', 'afraid', 'frightened', 'terrified', '공포', '두려움', '무서움', '겁', '怖い'],
    ['disgust', 'disgusted', 'gross', '혐오', '역겨움', '질색', '嫌悪'],
    ['neutral', 'default', 'normal', 'idle', 'calm', 'expressionless', '기본', '평소', '무표정', '평온', '차분', '通常', '無表情'],
    ['sleepy', 'tired', 'drowsy', 'exhausted', 'sleeping', '졸림', '졸린', '피곤', '眠い'],
    ['thinking', 'think', 'thoughtful', 'pondering', 'wondering', '생각', '고민', '考える'],
    ['curious', 'interested', '궁금', '호기심', '興味'],
    ['confused', 'puzzled', 'perplexed', 'confusion', '혼란', '어리둥절', '갸웃', '困惑'],
    ['smug', 'proud', 'confident', 'cocky', 'triumphant', '우쭐', '자신감', '의기양양', 'ドヤ顔'],
    ['pout', 'pouting', 'sulk', 'sulking', 'sulky', '삐짐', '삐진', '뾰로통', '토라짐'],
    ['nervous', 'anxious', 'worried', 'uneasy', 'tense', '긴장', '불안', '걱정', '초조', '不安'],
    ['excited', 'excitement', 'thrilled', 'eager', '신남', '신난', '흥분', '들뜸'],
    ['serious', 'stern', 'determined', 'focused', '진지', '단호', '결의', '真剣'],
    ['wink', 'winking', '윙크', 'ウインク'],
    ['kiss', 'kissing', '키스', '뽀뽀', 'キス'],
    ['hurt', 'pain', 'injured', 'painful', '아픔', '고통', '부상', '痛い'],
    ['relieved', 'relief', '안도', '안심', '安心'],
    ['jealous', 'envy', 'envious', '질투', '시기', '嫉妬'],
    ['bored', 'boredom', '지루함', '심심', '退屈'],
    ['grateful', 'thankful', '감사', '고마움', '感謝'],
    ['night', 'evening', '밤', '저녁', '夜'],
    ['day', 'daytime', 'noon', '낮', '昼'],
    ['morning', 'dawn', '아침', '새벽', '朝'],
];

const SYNONYM_INDEX = (() => {
    const map = new Map();
    SYNONYM_GROUPS.forEach(group => group.forEach(word => {
        const key = word.toLowerCase();
        if (!map.has(key)) map.set(key, group[0]);
    }));
    return map;
})();

const DEFAULT_RENDERER = {
    enabled: false,
    lazy: true,
    randomAsset: false,
    style: DEFAULT_RENDER_STYLE,
    maxWidth: 400,
    clickToZoom: true,
    caption: false,
    smartMatch: true,
    missing: 'chip',
};

const DEFAULT_INJECT = {
    enabled: false,
    position: 0,
    depth: 4,
    role: 0,
};

const DEFAULT_UI = {
    tab: 'assets',
    view: 'grid',
    sort: 'name',
    filter: 'all',
    accent: 'rose',
    setupHidden: false,
    promptLinked: false,
};

/* =========================================================
   공용 도구
   ========================================================= */

const _modules = new Map();

/** 실리 버전에 따라 없을 수도 있는 모듈은 동적으로 불러온다. */
function loadModule(path) {
    if (!_modules.has(path)) {
        _modules.set(path, import(path).catch((error) => {
            console.debug(`[${MODULE_NAME}] ${path} 불러오기 건너뜀:`, error?.message);
            return null;
        }));
    }
    return _modules.get(path);
}

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

const _decoder = document.createElement('textarea');
function decodeEntities(value) {
    const text = String(value ?? '');
    if (!text.includes('&')) return text;
    _decoder.innerHTML = text;
    return _decoder.value;
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function debounce(fn, wait) {
    let timer = null;
    const wrapped = (...args) => {
        clearTimeout(timer);
        timer = setTimeout(() => fn(...args), wait);
    };
    wrapped.cancel = () => clearTimeout(timer);
    return wrapped;
}

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

function formatBytes(bytes) {
    if (!Number.isFinite(bytes) || bytes <= 0) return '';
    if (bytes < 1024) return `${bytes}B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10240 ? 1 : 0)}KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

function stripQuery(path) {
    return String(path || '').split('?')[0];
}

function fileNameFromPath(path) {
    return stripQuery(path).split('/').pop() || '';
}

function mtimeFromPath(path) {
    const match = String(path || '').match(/[?&]t=(\d+)/);
    return match ? Number(match[1]) : 0;
}

function splitExt(fileName) {
    const dot = fileName.lastIndexOf('.');
    if (dot <= 0) return { base: fileName, ext: '' };
    return { base: fileName.substring(0, dot), ext: fileName.substring(dot + 1).toLowerCase() };
}

/**
 * 파일명에서 키워드 추출 (확장자 제거)
 */
function extractKeywordFromFileName(fileName) {
    return fileName.split('.').slice(0, -1).join('.');
}

/**
 * angry_1 / angry-2 / angry.3 → angry
 */
function extractBaseKeyword(fileName) {
    const lastDot = fileName.lastIndexOf('.');
    const nameWithoutExt = lastDot > 0 ? fileName.substring(0, lastDot) : fileName;
    const match = nameWithoutExt.match(/^(.+?)(?:[_.\-]\d+)$/);
    return match ? match[1] : nameWithoutExt;
}

function normalizeAssetKey(value) {
    return String(value || '').trim().toLowerCase();
}

function stripImageExt(name) {
    const match = String(name || '').match(/^(.*)\.(png|webp|gif|jpe?g)$/i);
    return match ? match[1] : String(name || '');
}

/** 대소문자·공백·구분자를 무시한 비교용 키 */
function looseKey(value) {
    return stripImageExt(normalizeAssetKey(value)).replace(/[\s_\-.]+/g, '');
}

function nameTokens(value) {
    return stripImageExt(normalizeAssetKey(value)).split(/[\s_\-.]+/).filter(Boolean);
}

/** 같은 뜻 단어를 대표 단어로 바꾼 키 (joy_2 → happy_2, 기쁨 → happy) */
function canonicalKey(value) {
    return nameTokens(value).map(token => SYNONYM_INDEX.get(token) || token).join('_');
}

function levenshtein(a, b, max = Infinity) {
    if (a === b) return 0;
    if (Math.abs(a.length - b.length) > max) return max + 1;
    let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
        const curr = [i];
        let rowMin = i;
        for (let j = 1; j <= b.length; j++) {
            const cost = a[i - 1] === b[j - 1] ? 0 : 1;
            curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
            if (curr[j] < rowMin) rowMin = curr[j];
        }
        if (rowMin > max) return max + 1;
        prev = curr;
    }
    return prev[b.length];
}

function naturalCompare(a, b) {
    return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });
}

function isImageFile(file) {
    if (!file) return false;
    const ext = splitExt(file.name || '').ext;
    return ALLOWED_EXTENSIONS.includes(ext) || ALLOWED_MIME.includes(file.type);
}

function isZipFile(file) {
    return Boolean(file) && (/\.zip$/i.test(file.name || '') || ['application/zip', 'application/x-zip-compressed'].includes(file.type));
}

function sanitizeBaseName(value) {
    return String(value || '').trim().replace(/[/\\:*?"<>|#%]/g, '_').replace(/\s+/g, ' ');
}

function mimeFromExt(ext) {
    return ({ png: 'image/png', webp: 'image/webp', gif: 'image/gif', jpg: 'image/jpeg', jpeg: 'image/jpeg' })[ext] || 'application/octet-stream';
}

function extFromMime(mime) {
    return ({ 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'image/jpeg': 'jpg' })[mime] || 'png';
}

function settings() {
    return extension_settings[MODULE_NAME];
}

function getRendererSettings() {
    return settings().renderer;
}

function getInjectSettings() {
    return settings().inject;
}

function getUiSettings() {
    return settings().ui;
}

/* =========================================================
   토스트 / 팝업
   ========================================================= */

function showToast(type, message, title = '', options = {}) {
    if (typeof toastr === 'undefined') {
        console.log(`[${String(type).toUpperCase()}] ${title ? title + ': ' : ''}${message}`);
        return null;
    }
    const merged = { timeOut: 3000, extendedTimeOut: 1000, ...options };
    const fn = toastr[type] || toastr.info;
    fn.call(toastr, message, title, merged);
    return toastr;
}

async function fixToastrLayer() {
    const mod = await loadModule('../../../popup.js');
    try { mod?.fixToastrForDialogs?.(); } catch { /* 무시 */ }
}

function makePopContent(content) {
    const $el = $('<div class="ca-pop ca-scope"></div>');
    applyScope($el[0]);
    if (typeof content === 'string') {
        $el.html(content);
    } else {
        $el.append(content);
    }
    return $el;
}

/**
 * 확인 팝업. 실리 신형 Popup이 있으면 그걸 쓰고, 없으면 callPopup으로 대체한다.
 * @returns {Promise<{ok: boolean, root: JQuery}>}
 */
async function confirmWithContent(content, { okButton = '확인', cancelButton = '취소', wide = false, large = false } = {}) {
    const $content = makePopContent(content);
    const mod = await loadModule('../../../popup.js');
    if (mod?.Popup && mod.POPUP_TYPE) {
        const popup = new mod.Popup($content, mod.POPUP_TYPE.CONFIRM, '', {
            okButton, cancelButton, wide, large, allowVerticalScrolling: true, leftAlign: true,
        });
        popup.dlg?.classList.add('ca-popup');
        const result = await popup.show();
        return { ok: result === mod.POPUP_RESULT.AFFIRMATIVE, root: $content };
    }
    const result = await callPopup($content.prop('outerHTML'), 'confirm', undefined, { okButton, wide });
    return { ok: result === true, root: $('#dialogue_popup_text .ca-pop').last() };
}

async function askConfirm(content, options = {}) {
    return (await confirmWithContent(content, options)).ok;
}

async function askInput(content, defaultValue = '', { okButton = '확인', placeholder = '' } = {}) {
    const $content = makePopContent(content);
    const mod = await loadModule('../../../popup.js');
    if (mod?.Popup && mod.POPUP_TYPE) {
        const popup = new mod.Popup($content, mod.POPUP_TYPE.INPUT, defaultValue, {
            okButton, cancelButton: '취소', placeholder, leftAlign: true,
        });
        popup.dlg?.classList.add('ca-popup');
        const result = await popup.show();
        return typeof result === 'string' ? result : null;
    }
    const result = await callPopup($content.prop('outerHTML'), 'input', defaultValue, { okButton });
    return typeof result === 'string' ? result : null;
}

/**
 * 버튼 여러 개 중 하나 고르기
 * @param {Array<{text: string, value: any}>} buttons
 */
async function askChoice(content, buttons, { cancelButton = '취소' } = {}) {
    const $content = makePopContent(content);
    const mod = await loadModule('../../../popup.js');
    if (mod?.Popup && mod.POPUP_TYPE) {
        const popup = new mod.Popup($content, mod.POPUP_TYPE.TEXT, '', {
            okButton: false,
            cancelButton,
            leftAlign: true,
            customButtons: buttons.map((button, index) => ({ text: button.text, result: 1001 + index, appendAtEnd: false })),
        });
        popup.dlg?.classList.add('ca-popup');
        const result = await popup.show();
        const index = Number(result) - 1001;
        return buttons[index] ? buttons[index].value : null;
    }
    const result = await callPopup($content.prop('outerHTML'), 'confirm', undefined, { okButton: buttons[0]?.text });
    return result === true ? buttons[0]?.value ?? null : null;
}

async function showInfo(content, { wide = false, large = false } = {}) {
    const $content = makePopContent(content);
    const mod = await loadModule('../../../popup.js');
    if (mod?.Popup && mod.POPUP_TYPE) {
        const popup = new mod.Popup($content, mod.POPUP_TYPE.TEXT, '', {
            okButton: '닫기', wide, large, allowVerticalScrolling: true, leftAlign: true,
        });
        popup.dlg?.classList.add('ca-popup');
        await popup.show();
        return;
    }
    await callPopup($content.prop('outerHTML'), 'text', undefined, { wide, large });
}

/**
 * 실리는 열린 서랍 밖을 누르면 서랍을 닫는다(.popup 제외).
 * 이 확장이 띄운 창(갤러리·크게 보기·메뉴) 안을 누를 때 설정 패널이 닫히지 않게 막는다.
 */
function shieldFromDrawerClose(element) {
    if (!element || element.dataset.caShielded) return;
    element.dataset.caShielded = '1';
    ['mousedown', 'touchstart'].forEach(type => element.addEventListener(type, (event) => event.stopPropagation(), { passive: true }));
}

/* =========================================================
   화면 (포인트 색, 밝은/어두운 테마 감지)
   ========================================================= */

const appearance = { scheme: 'dark' };

function detectScheme() {
    const probe = document.createElement('span');
    probe.style.cssText = 'position:absolute;visibility:hidden;pointer-events:none;color:var(--SmartThemeBodyColor, #dcdcd2)';
    document.body.appendChild(probe);
    const color = getComputedStyle(probe).color;
    probe.remove();
    const parts = (color.match(/[\d.]+/g) || []).map(Number);
    if (parts.length < 3) return 'dark';
    const [r, g, b] = parts;
    const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    // 글자색이 밝으면 어두운 테마
    return luminance > 0.55 ? 'dark' : 'light';
}

function applyScope(element) {
    if (!element) return;
    element.dataset.caAccent = getUiSettings()?.accent || 'rose';
    element.dataset.caScheme = appearance.scheme;
}

function applyAppearance() {
    appearance.scheme = detectScheme();
    document.querySelectorAll('.ca-scope').forEach(applyScope);
}

const applyAppearanceDebounced = debounce(applyAppearance, 300);

function watchThemeChanges() {
    const observer = new MutationObserver(applyAppearanceDebounced);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['style', 'class'] });
    observer.observe(document.body, { attributes: true, attributeFilter: ['class'] });
}

/* =========================================================
   설정 초기화
   ========================================================= */

function initializeSettings() {
    if (!extension_settings[MODULE_NAME] || typeof extension_settings[MODULE_NAME] !== 'object') {
        extension_settings[MODULE_NAME] = {};
    }
    const s = extension_settings[MODULE_NAME];

    if (!s.characterAssets || typeof s.characterAssets !== 'object') {
        s.characterAssets = {};
    }

    if (typeof s.imagePrompt !== 'string' || !s.imagePrompt) {
        s.imagePrompt = DEFAULT_IMAGE_PROMPT;
    }

    // 프리셋 데이터 초기화
    if (!Array.isArray(s.presets) || s.presets.length === 0) {
        s.presets = DEFAULT_PRESETS.map(preset => ({ id: uuidv4(), ...preset }));
        s.currentPresetId = s.presets[0].id;
    } else {
        s.presets = s.presets.filter(p => p && typeof p === 'object' && typeof p.name === 'string');
        s.presets.forEach(p => {
            if (!p.id) p.id = uuidv4();
            if (typeof p.prompt !== 'string') p.prompt = '';
        });
        const presetNames = new Set(s.presets.map(preset => preset.name));
        DEFAULT_PRESETS.forEach(defaultPreset => {
            if (!presetNames.has(defaultPreset.name)) {
                s.presets.push({ id: uuidv4(), ...defaultPreset });
            }
        });
    }

    if (!s.currentPresetId || !s.presets.some(preset => preset.id === s.currentPresetId)) {
        s.currentPresetId = s.presets[0].id;
    }

    if (typeof s.enabled === 'undefined') s.enabled = true;

    s.renderer = { ...DEFAULT_RENDERER, ...(s.renderer && typeof s.renderer === 'object' ? s.renderer : {}) };
    s.inject = { ...DEFAULT_INJECT, ...(s.inject && typeof s.inject === 'object' ? s.inject : {}) };
    s.ui = { ...DEFAULT_UI, ...(s.ui && typeof s.ui === 'object' ? s.ui : {}) };

    if (LEGACY_STYLE_MAP[s.renderer.style]) s.renderer.style = LEGACY_STYLE_MAP[s.renderer.style];
    if (!RENDER_STYLES.some(style => style.id === s.renderer.style)) s.renderer.style = DEFAULT_RENDER_STYLE;
    if (!ACCENTS.some(accent => accent.id === s.ui.accent)) s.ui.accent = 'rose';

    if (typeof s.convertToWebp === 'undefined') s.convertToWebp = false;
    if (typeof s.confirmOverwrite === 'undefined') s.confirmOverwrite = true;
    if (!s.gallerySettings || typeof s.gallerySettings !== 'object') s.gallerySettings = {};
    if (!['small', 'medium', 'large'].includes(s.gallerySettings.gridSize)) s.gallerySettings.gridSize = 'medium';
}

function defaultCharacterData() {
    return {
        enabled: true,
        imageKeywords: [],
        disabledAssets: [],
        aliases: {},
        linkedCharacter: '',
        activeAssetPreset: '',
        assetPresets: [],
        regexFind: DEFAULT_REGEX_FIND,
        regexReplace: DEFAULT_REGEX_REPLACE,
        regexOptions: { userInput: false, aiOutput: true, runOnEdit: true, onlyFormatDisplay: true },
    };
}

/**
 * 캐릭터의 에셋 정보 초기화 (자주 불리므로 가볍게 유지)
 */
function initializeCharacterAssets(characterId) {
    const all = settings().characterAssets;
    if (!all[characterId] || typeof all[characterId] !== 'object') {
        all[characterId] = defaultCharacterData();
    }
    const data = all[characterId];
    if (!Array.isArray(data.disabledAssets)) data.disabledAssets = [];
    if (!data.aliases || typeof data.aliases !== 'object' || Array.isArray(data.aliases)) data.aliases = {};
    if (typeof data.linkedCharacter !== 'string') data.linkedCharacter = '';
    if (typeof data.activeAssetPreset !== 'string') data.activeAssetPreset = '';
    if (!Array.isArray(data.assetPresets)) data.assetPresets = [];
    if (!data.regexOptions) data.regexOptions = { userInput: false, aiOutput: true, runOnEdit: true, onlyFormatDisplay: true };
    return data;
}

function getCharData(characterId) {
    return initializeCharacterAssets(characterId);
}

/**
 * 에셋 링크 값은 "다른 캐릭터의 실제 폴더명"만 허용한다.
 * 잘못된 값(프리셋명, 오타, 지워진 캐릭터)이면 비워서 잠금 상태가 남지 않게 한다.
 */
function validateLinkedCharacter(characterId) {
    const data = getCharData(characterId);
    let link = String(data.linkedCharacter || '').trim();
    if (!link) {
        data.linkedCharacter = '';
        return;
    }
    if (!Array.isArray(characters) || characters.length === 0) return;
    if (link === characterId || !characters.some(c => getCharId(c) === link)) {
        console.debug(`[${MODULE_NAME}] invalid linkedCharacter cleared for ${characterId}:`, link);
        link = '';
        saveSettingsDebounced();
    }
    data.linkedCharacter = link;
}

/* =========================================================
   캐릭터 / 그룹 / 페르소나
   ========================================================= */

function getCharId(character) {
    return character?.avatar ? String(character.avatar).replace(/\.[^/.]+$/, '') : '';
}

function getCurrentCharacter() {
    if (selected_group) return null;
    return characters[this_chid] ?? null;
}

function getCurrentCharId() {
    return getCharId(getCurrentCharacter());
}

function findCharacterById(id) {
    return characters.find(c => getCharId(c) === id) || null;
}

function isGroupMode() {
    return Boolean(selected_group);
}

async function getGroupCharacterIds() {
    if (!selected_group) return [];
    const mod = await loadModule('../../../group-chats.js');
    if (typeof mod?.getGroupMembers !== 'function') return [];
    try {
        const members = mod.getGroupMembers(selected_group) || [];
        return [...new Set(members.filter(m => m && m.avatar).map(m => getCharId(m)))];
    } catch (error) {
        console.debug(`[${MODULE_NAME}] getGroupCharacterIds error:`, error);
        return [];
    }
}

function getGroupName() {
    try {
        const ctx = getContext();
        return ctx.groups?.find(g => g.id === selected_group)?.name || '그룹 채팅';
    } catch {
        return '그룹 채팅';
    }
}

/**
 * 링크/버전을 반영한 실제 에셋 폴더 경로
 */
function getEffectiveCharacterName(characterName) {
    const charData = settings()?.characterAssets?.[characterName];
    let baseName = characterName;
    if (charData?.linkedCharacter) baseName = charData.linkedCharacter;
    if (charData?.activeAssetPreset) return `${baseName}/${charData.activeAssetPreset}`;
    return baseName;
}

function isAssetLinkActive(characterId) {
    return String(getCharData(characterId).linkedCharacter || '').trim().length > 0;
}

async function getPersonaModule() {
    return loadModule('../../../personas.js');
}

function getPersonaAvatar(mod) {
    const avatar = mod?.user_avatar;
    if (!avatar || avatar === 'img/user-default.png') return '';
    return avatar;
}

async function getPersonaName() {
    const mod = await getPersonaModule();
    const avatar = getPersonaAvatar(mod);
    return avatar ? avatar.replace(/\.[^/.]+$/, '') : '';
}

/* =========================================================
   서버 통신
   ========================================================= */

async function fetchFolderAssets(folder) {
    if (!folder) return [];
    try {
        const result = await fetch(`/api/sprites/get?name=${encodeURIComponent(folder)}`, { cache: 'no-cache' });
        if (!result.ok) return [];
        const data = await result.json();
        return Array.isArray(data) ? data : [];
    } catch (error) {
        console.error(`[${MODULE_NAME}] Error fetching assets:`, error);
        return [];
    }
}

function httpError(status, message) {
    const error = new Error(message || `HTTP ${status} 오류가 발생했습니다.`);
    error.status = status;
    return error;
}

async function postSpriteForm(url, formData) {
    // FormData 전송 시 Content-Type을 지워야 브라우저가 multipart boundary를 붙인다.
    const headers = getRequestHeaders();
    delete headers['Content-Type'];

    const response = await fetch(url, { method: 'POST', headers, body: formData, cache: 'no-cache' });
    if (!response.ok) {
        const message = await response.text().catch(() => '');
        throw httpError(response.status, message || `HTTP ${response.status} 오류가 발생했습니다.`);
    }
    const contentType = response.headers.get('content-type') || '';
    return contentType.includes('application/json') ? response.json() : {};
}

async function postSpriteJson(url, payload) {
    const response = await fetch(url, {
        method: 'POST',
        headers: getRequestHeaders(),
        body: JSON.stringify(payload),
        cache: 'no-cache',
    });
    if (!response.ok) {
        const message = await response.text().catch(() => '');
        throw httpError(response.status, message || `HTTP ${response.status} 오류가 발생했습니다.`);
    }
    const contentType = response.headers.get('content-type') || '';
    return contentType.includes('application/json') ? response.json() : {};
}

/** 통신 오류·서버 오류만 다시 시도한다. (CSRF·요청 형식 오류는 바로 실패) */
async function withRetry(task, retries = 2) {
    for (let attempt = 0; ; attempt++) {
        try {
            return await task();
        } catch (error) {
            const status = Number(error?.status || 0);
            const retriable = status === 0 || status >= 500 || status === 429;
            if (attempt >= retries || !retriable) throw error;
            await sleep(600 * (attempt + 1));
        }
    }
}

function describeError(error) {
    const message = error?.message || error?.responseText || '알 수 없는 오류';
    if (/CSRF/i.test(message) || error?.status === 403) {
        return 'CSRF 토큰이 만료되었어요. 페이지를 새로고침한 뒤 다시 시도해 주세요.';
    }
    if (error?.status === 400 || /Bad Request/i.test(message)) {
        return '요청 형식 오류예요. 파일명과 캐릭터 선택 상태를 확인해 주세요.';
    }
    if (error?.status === 413 || /payload too large/i.test(message)) {
        return '파일이 너무 커요.';
    }
    if (error instanceof TypeError) {
        return '서버에 연결하지 못했어요. 네트워크 상태를 확인해 주세요.';
    }
    return message;
}

function deleteAssetFile(asset) {
    return withRetry(() => postSpriteJson('/api/sprites/delete', {
        name: asset.folder,
        label: asset.label,
        spriteName: asset.base,
    }));
}

function uploadBlobAs(folder, blob, base, ext) {
    const file = blob instanceof File && blob.name === `${base}.${ext}` ? blob : new File([blob], `${base}.${ext}`, { type: blob.type || mimeFromExt(ext) });
    const formData = new FormData();
    formData.append('name', folder);
    formData.append('label', base);
    formData.append('avatar', file);
    formData.append('spriteName', base);
    return withRetry(() => postSpriteForm('/api/sprites/upload', formData));
}

async function fetchAssetBlob(asset) {
    const response = await fetch(asset.path);
    if (!response.ok) throw httpError(response.status, '원본 파일을 읽을 수 없어요.');
    return response.blob();
}

/**
 * 파일 이름 바꾸기 / 다른 폴더로 옮기기.
 * 새 이름으로 먼저 올린 뒤 원본을 지운다. 대소문자만 바뀌는 경우엔
 * (윈도우 같은 대소문자 무시 파일 시스템에서) 같은 파일로 취급되므로 원본을 먼저 지운다.
 */
async function moveAssetFile(asset, newBase, targetFolder = asset.folder) {
    const blob = await fetchAssetBlob(asset);
    const sameFolder = targetFolder === asset.folder;
    const caseOnly = sameFolder && newBase !== asset.base && newBase.toLowerCase() === asset.base.toLowerCase();

    if (caseOnly) {
        await deleteAssetFile(asset);
        try {
            await uploadBlobAs(targetFolder, blob, newBase, asset.ext);
        } catch (error) {
            await uploadBlobAs(targetFolder, blob, asset.base, asset.ext).catch(() => {});
            throw error;
        }
        return;
    }

    await uploadBlobAs(targetFolder, blob, newBase, asset.ext);
    if (!sameFolder || newBase !== asset.base) {
        await deleteAssetFile(asset);
    }
}

async function loadJSZip() {
    if (window.JSZip) return window.JSZip;
    try {
        await import('../../../../lib/jszip.min.js');
    } catch { /* 실리 번들이 없으면 CDN으로 */ }
    if (window.JSZip) return window.JSZip;
    try {
        const mod = await import('https://cdn.jsdelivr.net/npm/jszip@3.10.1/+esm');
        return mod.default || mod;
    } catch (error) {
        console.error(`[${MODULE_NAME}] JSZip load failed:`, error);
        return null;
    }
}

/* =========================================================
   에셋 저장소 (한 번 불러와서 목록·키워드·렌더러가 같이 쓴다)
   ========================================================= */

const store = {
    token: 0,
    ready: false,
    loading: false,
    viewKey: '',
    mode: 'none',
    ownerIds: [],
    owners: new Map(),
    persona: { name: '', folder: '', avatar: '', assets: [] },
    byKey: new Map(),
    byPath: new Map(),
};

function makeAsset(raw, ownerId, folder) {
    const fileName = fileNameFromPath(raw.path);
    const { base, ext } = splitExt(fileName);
    const label = String(raw.label ?? base).toLowerCase();
    return {
        key: `${ownerId}/${fileName}`,
        ownerId,
        folder,
        label,
        path: raw.path,
        fileName,
        base,
        ext,
        group: normalizeAssetKey(extractBaseKeyword(fileName)),
        card: extractBaseKeyword(label),
        mtime: mtimeFromPath(raw.path),
        disabled: false,
    };
}

async function loadPersonaAssets() {
    const mod = await getPersonaModule();
    const avatar = getPersonaAvatar(mod);
    if (!avatar) return { name: '', folder: '', avatar: '', assets: [] };
    const name = avatar.replace(/\.[^/.]+$/, '');
    const folder = `_persona_${name}`;
    const raw = await fetchFolderAssets(folder);
    return { name, folder, avatar, assets: raw.map(item => makeAsset(item, PERSONA_OWNER, folder)) };
}

async function refreshStore() {
    const token = ++store.token;
    store.loading = true;

    const group = isGroupMode();
    const currentId = group ? '' : getCurrentCharId();
    const ids = group ? await getGroupCharacterIds() : (currentId ? [currentId] : []);
    ids.forEach(initializeCharacterAssets);

    const [ownerList, persona] = await Promise.all([
        Promise.all(ids.map(async (id) => {
            const data = getCharData(id);
            const folder = getEffectiveCharacterName(id);
            const raw = await fetchFolderAssets(folder);
            const character = findCharacterById(id);
            return {
                id,
                name: character?.name || id,
                avatar: character?.avatar || '',
                folder,
                linked: data.linkedCharacter || '',
                version: data.activeAssetPreset || '',
                assets: raw.map(item => makeAsset(item, id, folder)),
            };
        })),
        loadPersonaAssets(),
    ]);

    // 그 사이 캐릭터가 바뀌었으면 버린다
    if (token !== store.token) return false;

    store.mode = group ? 'group' : (currentId ? 'single' : 'none');
    store.ownerIds = ids;
    store.owners = new Map(ownerList.map(owner => [owner.id, owner]));
    store.persona = persona;
    store.ready = true;
    store.loading = false;
    rebuildDerived();
    return true;
}

/** 파일을 다시 받지 않고 꺼짐/별칭 상태만 다시 계산한다. */
function rebuildDerived() {
    store.byKey = new Map();
    store.byPath = new Map();
    for (const owner of store.owners.values()) {
        const disabled = new Set(getCharData(owner.id).disabledAssets || []);
        owner.assets.sort((a, b) => naturalCompare(a.base, b.base) || naturalCompare(a.ext, b.ext));
        owner.assets.forEach(asset => {
            asset.disabled = disabled.has(asset.fileName);
            store.byKey.set(asset.key, asset);
            store.byPath.set(stripQuery(asset.path), asset);
        });
    }
    store.persona.assets.forEach(asset => {
        store.byKey.set(asset.key, asset);
        store.byPath.set(stripQuery(asset.path), asset);
    });
    rebuildKeywords();
    rebuildRendererIndex();
}

function getOwnerAssets() {
    const list = [];
    for (const owner of store.owners.values()) list.push(...owner.assets);
    return list;
}

function getActiveAssets() {
    return getOwnerAssets().filter(asset => !asset.disabled);
}

function getSingleOwner() {
    return store.mode === 'single' ? store.owners.get(store.ownerIds[0]) || null : null;
}

function getOwnerName(ownerId) {
    if (ownerId === PERSONA_OWNER) return `페르소나 · ${getContext().name1 || store.persona.name}`;
    return store.owners.get(ownerId)?.name || findCharacterById(ownerId)?.name || ownerId;
}

function getAliasesFor(asset) {
    if (!asset || asset.ownerId === PERSONA_OWNER) return [];
    const list = getCharData(asset.ownerId).aliases?.[asset.fileName];
    return Array.isArray(list) ? list : [];
}

function hasActiveAssets() {
    return activeAssetCount > 0;
}

/* ----- 키워드 ----- */

let autoGeneratedKeywords = '';
let autoGeneratedKeywordsGrouped = '';
let activeLabelList = '';
let activeAssetCount = 0;

function rebuildKeywords() {
    const active = getActiveAssets();
    activeAssetCount = active.length;
    const isRandomMode = Boolean(getRendererSettings().randomAsset);

    const names = new Set();
    active.forEach(asset => names.add(isRandomMode ? extractBaseKeyword(asset.fileName) : asset.fileName));
    autoGeneratedKeywords = Array.from(names).sort().join(', ');

    // 그룹핑된 키워드 (e.g., "angry_[1, 2, 3], happy, sad")
    const groupMap = {};
    active.forEach(asset => {
        const base = extractBaseKeyword(asset.fileName);
        const nameWithoutExt = asset.base;
        if (!groupMap[base]) groupMap[base] = [];
        if (base !== nameWithoutExt) {
            const suffix = nameWithoutExt.substring(base.length).replace(/^[_.\-]/, '');
            if (suffix && !groupMap[base].includes(suffix)) groupMap[base].push(suffix);
        }
    });
    autoGeneratedKeywordsGrouped = Object.keys(groupMap).sort().map(base => {
        const suffixes = groupMap[base];
        if (suffixes.length === 0) return base;
        suffixes.sort((a, b) => {
            const na = parseInt(a, 10);
            const nb = parseInt(b, 10);
            if (!isNaN(na) && !isNaN(nb)) return na - nb;
            return a.localeCompare(b);
        });
        return `${base}_[${suffixes.join(', ')}]`;
    }).join(', ');

    activeLabelList = Array.from(new Set(active.map(asset => asset.label))).sort().join(', ');
}

/* =========================================================
   이름 찾기 (렌더러 / 매크로 / 채팅 점검 공용)
   ========================================================= */

let renderIndex = createRenderIndex();

function createRenderIndex() {
    return {
        exact: new Map(),
        groups: new Map(),
        alias: new Map(),
        loose: new Map(),
        canon: new Map(),
        firstToken: new Map(),
        persona: new Map(),
        personaLoose: new Map(),
        fuzzy: [],
        cache: new Map(),
    };
}

function setFirst(map, key, value) {
    if (key && !map.has(key)) map.set(key, value);
}

function rebuildRendererIndex() {
    const index = createRenderIndex();
    const active = getActiveAssets();

    // 파일명 → 확장자 뺀 이름 → 라벨 순으로 우선한다
    active.forEach(asset => setFirst(index.exact, normalizeAssetKey(asset.fileName), asset));
    active.forEach(asset => setFirst(index.exact, normalizeAssetKey(asset.base), asset));
    active.forEach(asset => setFirst(index.exact, normalizeAssetKey(asset.label), asset));

    const seenLoose = new Set();
    active.forEach(asset => {
        if (!index.groups.has(asset.group)) index.groups.set(asset.group, []);
        index.groups.get(asset.group).push(asset);

        getAliasesFor(asset).forEach(alias => setFirst(index.alias, stripImageExt(normalizeAssetKey(alias)), asset));

        const loose = looseKey(asset.base);
        setFirst(index.loose, loose, asset);
        setFirst(index.canon, canonicalKey(asset.base), asset);
        setFirst(index.firstToken, nameTokens(asset.base)[0], asset);
        if (loose && !seenLoose.has(loose)) {
            seenLoose.add(loose);
            index.fuzzy.push({ key: loose, asset });
        }
    });

    // 묶음 이름(angry_1 → angry)의 같은 뜻 키는 정확한 이름 다음 순위로
    active.forEach(asset => setFirst(index.canon, canonicalKey(asset.group), asset));

    store.persona.assets.forEach(asset => {
        setFirst(index.persona, normalizeAssetKey(asset.fileName), asset);
        setFirst(index.persona, normalizeAssetKey(asset.base), asset);
        setFirst(index.persona, normalizeAssetKey(asset.label), asset);
        setFirst(index.personaLoose, looseKey(asset.base), asset);
    });

    renderIndex = index;
}

function smartResolve(noExt) {
    const index = renderIndex;
    const loose = looseKey(noExt);
    if (!loose) return null;

    let hit = index.loose.get(loose) || index.personaLoose.get(loose);
    if (hit) return hit;

    // angry.png 라고 썼는데 angry_1, angry_2 만 있는 경우
    const group = index.groups.get(noExt) || index.groups.get(normalizeAssetKey(extractBaseKeyword(noExt)));
    if (group?.length) return group[0];

    // 같은 뜻 단어 (joy → happy, 기쁨 → happy)
    hit = index.canon.get(canonicalKey(noExt)) || index.canon.get(canonicalKey(extractBaseKeyword(noExt)));
    if (hit) return hit;

    // happy → happy_smile 처럼 앞 단어가 같은 경우
    const tokens = nameTokens(noExt);
    if (tokens.length === 1 && tokens[0].length >= 3) {
        hit = index.firstToken.get(tokens[0]) || index.firstToken.get(SYNONYM_INDEX.get(tokens[0]) || '');
        if (hit) return hit;
    }

    // 오타 (한두 글자 차이)
    if (loose.length >= 3) {
        const max = loose.length <= 5 ? 1 : loose.length <= 10 ? 2 : 3;
        let best = null;
        let bestDistance = max + 1;
        for (const candidate of index.fuzzy) {
            if (Math.abs(candidate.key.length - loose.length) > max) continue;
            const distance = levenshtein(loose, candidate.key, max);
            if (distance < bestDistance) {
                bestDistance = distance;
                best = candidate.asset;
                if (distance === 0) break;
            }
        }
        if (best) return best;
    }
    return null;
}

/**
 * 태그 이름으로 에셋 찾기
 * @param {string} rawName
 * @param {{stable?: boolean}} options stable이면 랜덤 묶음에서도 항상 첫 파일을 돌려준다
 */
function resolveAsset(rawName, { stable = false } = {}) {
    const name = String(rawName || '').trim();
    if (!name) return null;
    const key = normalizeAssetKey(name);
    const noExt = stripImageExt(key);
    const rendererSettings = getRendererSettings();

    if (rendererSettings.randomAsset) {
        const group = renderIndex.groups.get(key) || renderIndex.groups.get(noExt);
        if (group?.length) {
            return stable ? group[0] : group[Math.floor(Math.random() * group.length)];
        }
    }

    if (renderIndex.cache.has(key)) return renderIndex.cache.get(key);

    let hit = renderIndex.exact.get(key)
        || renderIndex.exact.get(noExt)
        || renderIndex.alias.get(noExt)
        || renderIndex.persona.get(key)
        || renderIndex.persona.get(noExt)
        || null;

    if (!hit && rendererSettings.smartMatch) {
        hit = smartResolve(noExt);
    }

    renderIndex.cache.set(key, hit);
    return hit;
}

function randomAssetUrl(prefix) {
    const trimmed = normalizeAssetKey(prefix);
    if (!trimmed) return '';
    const group = renderIndex.groups.get(trimmed);
    if (group?.length) return group[Math.floor(Math.random() * group.length)].path;
    const matches = getActiveAssets().filter(asset => normalizeAssetKey(asset.fileName).startsWith(trimmed));
    return matches.length ? matches[Math.floor(Math.random() * matches.length)].path : '';
}

/** 못 찾은 이름에 대해 비슷한 에셋 후보를 점수순으로 */
function suggestAssets(name, limit = 3) {
    const target = looseKey(name);
    const canon = canonicalKey(name);
    if (!target) return [];
    const seen = new Set();
    const scored = [];
    for (const asset of getActiveAssets()) {
        if (seen.has(asset.card)) continue;
        seen.add(asset.card);
        const candidate = looseKey(asset.base);
        let score = 1 - levenshtein(target, candidate) / Math.max(target.length, candidate.length, 1);
        if (canonicalKey(asset.base) === canon || canonicalKey(asset.group) === canon) score += 0.6;
        if (candidate.includes(target) || target.includes(candidate)) score += 0.25;
        if (score > 0.35) scored.push({ asset, score });
    }
    return scored.sort((a, b) => b.score - a.score).slice(0, limit).map(item => item.asset);
}

/* =========================================================
   프롬프트 자동 삽입
   ========================================================= */

function getImagePromptText() {
    return settings().imagePrompt || DEFAULT_IMAGE_PROMPT;
}

function updatePromptInjection() {
    if (typeof Script.setExtensionPrompt !== 'function') return;
    const inject = getInjectSettings();
    const active = inject.enabled && hasActiveAssets();
    const value = active ? getImagePromptText() : '';
    const position = Number(inject.position) || 0;
    const depth = clamp(Number(inject.depth) || 0, 0, 999);
    const role = Number(inject.role) || 0;
    try {
        Script.setExtensionPrompt(INJECT_KEY, value, position, depth, false, role, () => getInjectSettings().enabled && hasActiveAssets());
    } catch (error) {
        console.debug(`[${MODULE_NAME}] setExtensionPrompt failed:`, error);
    }
}

/* =========================================================
   채팅 렌더러
   ========================================================= */

const renderer = {
    mutation: null,
    intersection: null,
    visible: new WeakSet(),
    pending: new Set(),
    frame: 0,
    fullPassTimer: 0,
};

function isBuiltinRendererEnabled() {
    return Boolean(getRendererSettings().enabled);
}

function currentStyleId() {
    const style = getRendererSettings().style;
    return RENDER_STYLES.some(item => item.id === style) ? style : DEFAULT_RENDER_STYLE;
}

function tapeColor() {
    const accent = ACCENTS.find(item => item.id === getUiSettings().accent);
    return accent ? accent.color : '#f0a3bd';
}

/**
 * @param {object} asset
 * @param {string} tag 원래 태그 이름 (다시 그릴 때 씀)
 * @param {{style?: string, maxWidth?: number, eager?: boolean, caption?: boolean}} [options]
 */
function buildAssetHtml(asset, tag, options = {}) {
    const s = getRendererSettings();
    const style = options.style || currentStyleId();
    const width = clamp(Number(options.maxWidth ?? s.maxWidth) || 400, 40, 1600);
    const label = escapeHtml(asset.base);
    const classes = ['ca-asset', `ca-as-${style}`];
    if (s.clickToZoom && !options.style) classes.push('is-zoomable');
    const lazy = s.lazy && !options.eager ? ' loading="lazy"' : '';
    const showCaption = options.caption ?? s.caption;
    const caption = showCaption ? `<span class="ca-asset__cap">${label}</span>` : '';
    return `<span class="${classes.join(' ')}" style="--ca-asset-max:${width}px;--ca-tape:${tapeColor()}" data-ca-tag="${escapeHtml(tag)}"><img class="character-asset-rendered" src="${escapeHtml(asset.path)}" alt="${label}"${lazy} decoding="async" draggable="false">${caption}</span>`;
}

function buildMissingHtml(tag, raw) {
    const mode = getRendererSettings().missing;
    if (mode === 'raw') return raw;
    const hidden = mode === 'hide' ? ' hidden' : '';
    return `<span class="ca-asset-missing" data-ca-tag="${escapeHtml(tag)}" title="이 이름의 에셋을 찾지 못했어요"${hidden}><i class="fa-solid fa-image" aria-hidden="true"></i>${escapeHtml(tag)}</span>`;
}

function renderTag(rawName, rawMatch) {
    const tag = decodeEntities(rawName).trim();
    const asset = resolveAsset(tag);
    return asset ? buildAssetHtml(asset, tag) : buildMissingHtml(tag, rawMatch);
}

function processMessage(mes) {
    if (!mes || !mes.isConnected) return;
    const textElement = mes.querySelector('.mes_text');
    if (!textElement) return;
    // textContent 확인이 innerHTML 직렬화보다 훨씬 싸다
    const text = textElement.textContent;
    if (!text || !text.includes('{{img::')) return;

    const html = textElement.innerHTML;
    let changed = false;
    const next = html
        .replace(CODE_WRAPPED_TAG_REGEX, '$1')
        .replace(IMG_TAG_REGEX, (match, name) => {
            const output = renderTag(name, match);
            if (output !== match) changed = true;
            return output;
        });
    if (changed) textElement.innerHTML = next;
}

function flushPendingMessages() {
    renderer.frame = 0;
    const lazy = Boolean(getRendererSettings().lazy) && renderer.intersection;
    for (const mes of renderer.pending) {
        if (!lazy || renderer.visible.has(mes)) processMessage(mes);
    }
    renderer.pending.clear();
}

function queueMessage(mes) {
    if (!mes) return;
    renderer.pending.add(mes);
    if (!renderer.frame) {
        renderer.frame = requestAnimationFrame(flushPendingMessages);
    }
}

function observeMessage(mes) {
    renderer.intersection?.observe(mes);
}

function onChatMutations(mutations) {
    for (const mutation of mutations) {
        if (mutation.type === 'childList') {
            for (const node of mutation.addedNodes) {
                if (node.nodeType !== 1) continue;
                if (node.classList.contains('mes')) {
                    observeMessage(node);
                    queueMessage(node);
                } else if (node.firstElementChild && !node.closest?.('.mes')) {
                    node.querySelectorAll('.mes').forEach(el => {
                        observeMessage(el);
                        queueMessage(el);
                    });
                }
            }
        }
        const target = mutation.target.nodeType === 1 ? mutation.target : mutation.target.parentElement;
        const mes = target?.closest?.('.mes');
        if (mes) queueMessage(mes);
    }
}

function scheduleRendererPass() {
    if (!isBuiltinRendererEnabled()) return;
    clearTimeout(renderer.fullPassTimer);
    renderer.fullPassTimer = setTimeout(() => {
        document.querySelectorAll('#chat .mes').forEach(queueMessage);
    }, 60);
}

/** 이미 그려진 이미지/안내를 현재 설정으로 다시 그린다. (스타일·크기 변경, 에셋 추가 시) */
function refreshChatAssets() {
    const chat = document.getElementById('chat');
    if (!chat) return;
    if (!isBuiltinRendererEnabled()) return;
    chat.querySelectorAll('.mes_text [data-ca-tag]').forEach(element => {
        const tag = element.getAttribute('data-ca-tag') || '';
        const currentSrc = element.querySelector('img')?.getAttribute('src');
        let asset = null;
        // 랜덤 모드에서도 이미 보이던 그림은 유지
        if (currentSrc) {
            const known = store.byPath.get(stripQuery(currentSrc));
            if (known && !known.disabled) asset = known;
        }
        if (!asset) asset = resolveAsset(tag);
        const raw = `{{img::${escapeHtml(tag)}}}`;
        const html = asset ? buildAssetHtml(asset, tag) : buildMissingHtml(tag, raw);
        if (element.outerHTML !== html) element.outerHTML = html;
    });
    scheduleRendererPass();
}

function restoreRawTagsInChat() {
    document.querySelectorAll('#chat .mes_text [data-ca-tag]').forEach(element => {
        element.replaceWith(document.createTextNode(`{{img::${element.getAttribute('data-ca-tag') || ''}}}`));
    });
}

function teardownRenderer() {
    renderer.mutation?.disconnect();
    renderer.intersection?.disconnect();
    renderer.mutation = null;
    renderer.intersection = null;
    renderer.visible = new WeakSet();
    renderer.pending.clear();
    if (renderer.frame) cancelAnimationFrame(renderer.frame);
    renderer.frame = 0;
}

function setupBuiltinRenderer() {
    teardownRenderer();
    if (!isBuiltinRendererEnabled()) {
        restoreRawTagsInChat();
        return;
    }

    const chat = document.getElementById('chat');
    if (!chat) return;

    if (getRendererSettings().lazy && 'IntersectionObserver' in window) {
        renderer.intersection = new IntersectionObserver((entries) => {
            for (const entry of entries) {
                if (entry.isIntersecting) {
                    renderer.visible.add(entry.target);
                    queueMessage(entry.target);
                } else {
                    renderer.visible.delete(entry.target);
                }
            }
        }, { root: null, rootMargin: '600px 0px' });
        chat.querySelectorAll('.mes').forEach(el => renderer.intersection.observe(el));
    }

    renderer.mutation = new MutationObserver(onChatMutations);
    renderer.mutation.observe(chat, { childList: true, subtree: true, characterData: true });
    refreshChatAssets();
    scheduleRendererPass();
}

function setupChatInteractions() {
    const chat = document.getElementById('chat');
    if (!chat) return;

    // 채팅 속 이미지 눌러서 크게 보기
    chat.addEventListener('click', (event) => {
        const img = event.target instanceof Element ? event.target.closest('.ca-asset.is-zoomable img') : null;
        if (!img) return;
        event.preventDefault();
        const textElement = img.closest('.mes_text');
        const images = Array.from(textElement?.querySelectorAll('.ca-asset img') || [img]);
        const items = images.map(el => store.byPath.get(stripQuery(el.getAttribute('src'))) || pseudoAssetFromImg(el));
        openLightbox(items, Math.max(0, images.indexOf(img)));
    });

    // 깨진 이미지는 숨긴다
    chat.addEventListener('error', (event) => {
        const target = event.target;
        if (target instanceof HTMLImageElement && target.classList.contains('character-asset-rendered')) {
            target.closest('.ca-asset')?.classList.add('is-broken');
        }
    }, true);
}

function pseudoAssetFromImg(img) {
    const src = img.getAttribute('src') || '';
    const fileName = fileNameFromPath(src);
    const { base, ext } = splitExt(fileName);
    return { key: src, ownerId: '', folder: '', label: base, path: src, fileName, base, ext, disabled: false, pseudo: true };
}

/* =========================================================
   진행 표시 / 작업 큐
   ========================================================= */

const job = { active: false, cancelled: false, hideTimer: 0 };

function progressStart(label, total) {
    clearTimeout(job.hideTimer);
    job.active = true;
    job.cancelled = false;
    $('#ca_upload_progress').prop('hidden', false);
    $('#ca_upload_cancel_btn').prop('hidden', false).prop('disabled', false);
    $('#ca_upload_progress_label').text(label);
    $('#ca_upload_progress_count').text(total ? `0 / ${total}` : '');
    $('#ca_upload_progress_fill').css('width', total ? '0%' : '35%');
}

function progressUpdate(done, total, failed = 0) {
    const percent = total ? Math.round((done / total) * 100) : 100;
    $('#ca_upload_progress_count').text(`${done} / ${total}${failed ? ` · 실패 ${failed}` : ''}`);
    $('#ca_upload_progress_fill').css('width', `${percent}%`);
}

function progressEnd(message) {
    job.active = false;
    $('#ca_upload_cancel_btn').prop('hidden', true);
    if (message) $('#ca_upload_progress_label').text(message);
    $('#ca_upload_progress_fill').css('width', '100%');
    job.hideTimer = setTimeout(() => $('#ca_upload_progress').prop('hidden', true), 1400);
}

function ensureNoJob() {
    if (job.active) {
        showToast('info', '진행 중인 작업이 끝난 뒤에 다시 해 주세요.');
        return false;
    }
    return true;
}

/**
 * 동시에 몇 개씩만 처리하는 작업 큐 (한꺼번에 보내서 서버가 막히는 걸 막는다)
 */
async function runQueue(items, worker, { label, concurrency = UPLOAD_CONCURRENCY } = {}) {
    let cursor = 0;
    let done = 0;
    let failed = 0;
    const errors = [];
    progressStart(label, items.length);

    const lane = async () => {
        while (cursor < items.length && !job.cancelled) {
            const item = items[cursor++];
            try {
                await worker(item);
            } catch (error) {
                failed++;
                errors.push({ item, error });
                console.error(`[${MODULE_NAME}] queue item failed:`, error);
            }
            done++;
            progressUpdate(done, items.length, failed);
        }
    };

    await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, items.length)) }, lane));
    const cancelled = job.cancelled;
    progressEnd(cancelled ? '취소했어요' : (failed ? `완료 · ${failed}개 실패` : '완료했어요'));
    return { done, failed, errors, cancelled, succeeded: done - failed };
}

/* =========================================================
   업로드
   ========================================================= */

/**
 * 설정이 켜져 있으면 PNG/JPEG를 WebP로 변환 (GIF/WebP는 그대로)
 * 변환 결과가 원본보다 크면 원본을 쓴다.
 */
async function maybeConvertToWebp(file) {
    if (!settings().convertToWebp) return file;
    if (!['image/png', 'image/jpeg'].includes(file.type)) return file;

    try {
        const bitmap = await createImageBitmap(file);
        let blob;
        if (typeof OffscreenCanvas !== 'undefined') {
            const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
            canvas.getContext('2d').drawImage(bitmap, 0, 0);
            blob = await canvas.convertToBlob({ type: 'image/webp', quality: 0.9 });
        } else {
            const canvas = document.createElement('canvas');
            canvas.width = bitmap.width;
            canvas.height = bitmap.height;
            canvas.getContext('2d').drawImage(bitmap, 0, 0);
            blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/webp', 0.9));
        }
        bitmap.close?.();
        if (!blob || blob.type !== 'image/webp' || blob.size >= file.size) return file;
        return new File([blob], file.name.replace(/\.[^/.]+$/, '') + '.webp', { type: 'image/webp' });
    } catch (error) {
        console.debug(`[${MODULE_NAME}] WebP 변환 실패, 원본 사용:`, error);
        return file;
    }
}

function getTargetAssets(target) {
    if (target.ownerId === PERSONA_OWNER) return store.persona.assets;
    return store.owners.get(target.ownerId)?.assets || [];
}

/** 같은 이름(확장자 무관)이 이미 있으면 덮어쓸지 묻는다 */
async function confirmOverwriteIfNeeded(target, fileNames) {
    if (!settings().confirmOverwrite) return true;
    const existing = new Set(getTargetAssets(target).map(asset => asset.base.toLowerCase()));
    const duplicates = fileNames.filter(name => existing.has(splitExt(name).base.toLowerCase()));
    if (duplicates.length === 0) return true;

    const preview = duplicates.slice(0, 6).map(name => `<code>${escapeHtml(name)}</code>`).join(' ');
    const more = duplicates.length > 6 ? ` 외 ${duplicates.length - 6}개` : '';
    return askConfirm(
        `<h3><i class="fa-solid fa-copy"></i> 같은 이름이 있어요</h3>
         <p>${duplicates.length}개 파일을 덮어써요. 계속할까요?</p>
         <div class="ca-chips">${preview}${more}</div>`,
        { okButton: '덮어쓰기' },
    );
}

function characterTarget(owner) {
    return { folder: owner.folder, ownerId: owner.id, title: owner.name };
}

async function personaTarget() {
    const name = store.persona.name || await getPersonaName();
    if (!name) {
        showToast('error', '페르소나가 설정되어 있지 않아요.');
        return null;
    }
    return { folder: `_persona_${name}`, ownerId: PERSONA_OWNER, title: '페르소나' };
}

/**
 * 업로드할 캐릭터 고르기. 그룹 채팅이면 멤버를 고르는 메뉴를 띄운다.
 */
function pickUploadTarget(anchor) {
    if (store.mode === 'single') {
        const owner = getSingleOwner();
        if (!owner) return Promise.resolve(null);
        if (isAssetLinkActive(owner.id)) {
            showToast('info', '에셋 링크를 쓰는 중에는 올릴 수 없어요. 링크된 캐릭터에서 올려 주세요.');
            return Promise.resolve(null);
        }
        return Promise.resolve(characterTarget(owner));
    }
    if (store.mode === 'group') {
        const owners = Array.from(store.owners.values()).filter(owner => !isAssetLinkActive(owner.id));
        if (owners.length === 0) {
            showToast('info', '올릴 수 있는 멤버가 없어요.');
            return Promise.resolve(null);
        }
        return new Promise(resolve => {
            openMenu(anchor, owners.map(owner => ({
                icon: 'fa-user',
                label: owner.name,
                action: () => resolve(characterTarget(owner)),
            })), { title: '어느 멤버에게 올릴까요?', onClose: () => resolve(null) });
        });
    }
    showToast('info', '캐릭터를 먼저 선택해 주세요.');
    return Promise.resolve(null);
}

async function uploadImageFiles(fileList, target) {
    if (!target || !ensureNoJob()) return;
    const files = Array.from(fileList || []);
    const valid = [];
    const invalid = [];
    for (const file of files) {
        if (!isImageFile(file) || !extractKeywordFromFileName(file.name)) {
            invalid.push(file.name || '이름 없음');
        } else {
            valid.push(file);
        }
    }
    if (invalid.length) {
        showToast('warning', `지원하지 않는 파일은 건너뛰었어요: ${invalid.slice(0, 5).join(', ')}${invalid.length > 5 ? ' …' : ''}`);
    }
    if (valid.length === 0) return;

    const proceed = await confirmOverwriteIfNeeded(target, valid.map(file => file.name));
    if (!proceed) return;

    const result = await runQueue(valid, async (file) => {
        const uploadFile = await maybeConvertToWebp(file);
        const label = extractKeywordFromFileName(uploadFile.name);
        const formData = new FormData();
        formData.append('name', target.folder);
        formData.append('label', label);
        formData.append('avatar', uploadFile);
        formData.append('spriteName', label);
        await withRetry(() => postSpriteForm('/api/sprites/upload', formData));
    }, { label: `${target.title}에 올리는 중…` });

    if (result.failed) {
        showToast('error', `${result.succeeded}개 올렸고 ${result.failed}개는 실패했어요. ${describeError(result.errors[0]?.error)}`, '업로드 일부 실패');
    } else if (!result.cancelled) {
        showToast('success', `${result.succeeded}개 이미지를 올렸어요.`);
    }
    await reloadAll();
}

async function uploadZipFile(file, target) {
    if (!target || !ensureNoJob()) return;
    if (!isZipFile(file)) {
        showToast('error', 'ZIP 파일만 올릴 수 있어요.');
        return;
    }

    // 압축을 미리 열어 덮어쓰기 확인 / WebP 변환을 처리한다
    const JSZip = (settings().convertToWebp || settings().confirmOverwrite) ? await loadJSZip() : null;
    if (JSZip) {
        let zip = null;
        try {
            zip = await JSZip.loadAsync(file);
        } catch (error) {
            console.debug(`[${MODULE_NAME}] ZIP 미리 읽기 실패, 서버로 바로 보냄:`, error);
        }
        if (zip) {
            const entries = Object.values(zip.files).filter(entry => {
                if (entry.dir) return false;
                const parts = entry.name.split('/');
                const name = parts.pop();
                if (!name || name.startsWith('.') || parts.some(p => p === '__MACOSX')) return false;
                return ALLOWED_EXTENSIONS.includes(splitExt(name).ext);
            });
            if (entries.length === 0) {
                showToast('warning', 'ZIP 안에서 이미지를 찾지 못했어요.');
                return;
            }
            const names = entries.map(entry => entry.name.split('/').pop());
            const proceed = await confirmOverwriteIfNeeded(target, names);
            if (!proceed) return;

            if (settings().convertToWebp) {
                const result = await runQueue(entries, async (entry) => {
                    const name = entry.name.split('/').pop();
                    const blob = await entry.async('blob');
                    const source = new File([blob], name, { type: mimeFromExt(splitExt(name).ext) });
                    const uploadFile = await maybeConvertToWebp(source);
                    const label = extractKeywordFromFileName(uploadFile.name);
                    const formData = new FormData();
                    formData.append('name', target.folder);
                    formData.append('label', label);
                    formData.append('avatar', uploadFile);
                    formData.append('spriteName', label);
                    await withRetry(() => postSpriteForm('/api/sprites/upload', formData));
                }, { label: `ZIP 풀어서 올리는 중… (WebP 변환)` });
                if (result.failed) {
                    showToast('error', `${result.succeeded}개 올렸고 ${result.failed}개는 실패했어요.`, '업로드 일부 실패');
                } else if (!result.cancelled) {
                    showToast('success', `${result.succeeded}개 이미지를 올렸어요.`);
                }
                await reloadAll();
                return;
            }
        }
    }

    progressStart('ZIP 올리는 중…', 0);
    $('#ca_upload_cancel_btn').prop('hidden', true);
    try {
        const formData = new FormData();
        formData.append('name', target.folder);
        formData.append('avatar', file);
        const result = await withRetry(() => postSpriteForm('/api/sprites/upload-zip', formData), 1);
        progressEnd('완료했어요');
        showToast('success', `${result.count ?? 0}개 이미지를 올렸어요.`, 'ZIP 업로드');
    } catch (error) {
        progressEnd('실패했어요');
        console.error(`[${MODULE_NAME}] Error uploading ZIP:`, error);
        showToast('error', `ZIP 업로드 중 오류가 났어요. ${describeError(error)}`, '업로드 실패');
    }
    await reloadAll();
}

async function handleDroppedFiles(fileList, target) {
    const files = Array.from(fileList || []);
    if (files.length === 0 || !target) return;
    const zip = files.find(isZipFile);
    if (zip) {
        await uploadZipFile(zip, target);
        return;
    }
    const images = files.filter(isImageFile);
    if (images.length === 0) {
        showToast('warning', '올릴 수 있는 이미지가 없어요.');
        return;
    }
    await uploadImageFiles(images, target);
}

/** 붙여넣은 이미지는 보통 image.png 라서 이름을 물어본다 */
async function handlePastedImages(files, target) {
    if (!target) return;
    const renamed = [];
    for (const file of files) {
        const ext = splitExt(file.name || '').ext || extFromMime(file.type);
        const suggested = files.length === 1 && file.name && !/^image\.\w+$/i.test(file.name)
            ? splitExt(file.name).base
            : `pasted_${new Date().toISOString().replace(/\D/g, '').slice(2, 14)}${renamed.length ? `_${renamed.length + 1}` : ''}`;
        const name = files.length === 1
            ? await askInput('<h3><i class="fa-solid fa-paste"></i> 붙여넣은 이미지</h3><p>키워드로 쓸 이름을 적어 주세요. (확장자 제외)</p>', suggested, { okButton: '올리기' })
            : suggested;
        if (name === null) return;
        const base = sanitizeBaseName(name) || suggested;
        renamed.push(new File([file], `${base}.${ext}`, { type: file.type || mimeFromExt(ext) }));
    }
    await uploadImageFiles(renamed, target);
}

async function uploadFromUrl(target, url, label) {
    if (!target) return false;
    let response;
    try {
        response = await fetch(url);
    } catch (error) {
        showToast('error', '이 주소는 브라우저에서 바로 받을 수 없어요. 이미지를 저장한 뒤 올려 주세요.', 'URL 업로드');
        return false;
    }
    if (!response.ok) {
        showToast('error', `이미지를 받지 못했어요. (HTTP ${response.status})`, 'URL 업로드');
        return false;
    }
    const blob = await response.blob();
    if (!ALLOWED_MIME.includes(blob.type)) {
        showToast('error', 'PNG, WebP, GIF, JPG 이미지만 올릴 수 있어요.', 'URL 업로드');
        return false;
    }
    const base = sanitizeBaseName(label) || 'image';
    await uploadImageFiles([new File([blob], `${base}.${extFromMime(blob.type)}`, { type: blob.type })], target);
    return true;
}

async function openUrlUploadDialog(anchor) {
    const target = await pickUploadTarget(anchor);
    if (!target) return;
    const $content = $(`
        <div>
            <h3><i class="fa-solid fa-link"></i> URL로 올리기</h3>
            <p>이미지 주소와 키워드로 쓸 이름을 적어 주세요.</p>
            <div class="ca-field">
                <label class="ca-label" for="ca_url_input"><span>이미지 주소</span></label>
                <input type="url" id="ca_url_input" class="text_pole" placeholder="https://…" autocomplete="off">
            </div>
            <div class="ca-field">
                <label class="ca-label" for="ca_url_name"><span>이름</span><small>비워 두면 주소의 파일명을 써요.</small></label>
                <input type="text" id="ca_url_name" class="text_pole" autocomplete="off">
            </div>
        </div>`);
    $content.find('#ca_url_input').on('input', function () {
        const $name = $content.find('#ca_url_name');
        if ($name.data('touched')) return;
        try {
            const last = decodeURIComponent(new URL(String($(this).val())).pathname.split('/').pop() || '');
            $name.val(stripImageExt(last));
        } catch { /* 입력 중 */ }
    });
    $content.find('#ca_url_name').on('input', function () { $(this).data('touched', true); });

    const { ok, root } = await confirmWithContent($content, { okButton: '올리기' });
    if (!ok) return;
    const url = String(root.find('#ca_url_input').val() || '').trim();
    const name = String(root.find('#ca_url_name').val() || '').trim();
    if (!/^https?:\/\//i.test(url)) {
        showToast('warning', 'http:// 또는 https:// 로 시작하는 주소를 넣어 주세요.');
        return;
    }
    let label = name;
    if (!label) {
        try { label = stripImageExt(decodeURIComponent(new URL(url).pathname.split('/').pop() || '')); } catch { label = ''; }
    }
    await uploadFromUrl(target, url, label || 'image');
}

/* =========================================================
   에셋 편집 (켜기/끄기, 별칭, 이름 변경, 삭제)
   ========================================================= */

function afterLocalChange() {
    rebuildDerived();
    renderAll();
    refreshChatAssets();
    updatePromptInjection();
}

function setAssetsDisabled(assets, disabled) {
    const byOwner = new Map();
    assets.filter(asset => asset.ownerId && asset.ownerId !== PERSONA_OWNER).forEach(asset => {
        if (!byOwner.has(asset.ownerId)) byOwner.set(asset.ownerId, []);
        byOwner.get(asset.ownerId).push(asset.fileName);
    });
    if (byOwner.size === 0) return;
    for (const [ownerId, names] of byOwner) {
        const data = getCharData(ownerId);
        const set = new Set(data.disabledAssets);
        names.forEach(name => (disabled ? set.add(name) : set.delete(name)));
        data.disabledAssets = Array.from(set);
    }
    saveSettingsDebounced();
    afterLocalChange();
}

function toggleAsset(asset) {
    if (!asset || asset.ownerId === PERSONA_OWNER) return;
    setAssetsDisabled([asset], !asset.disabled);
}

function isLocked(asset) {
    return asset.ownerId !== PERSONA_OWNER && isAssetLinkActive(asset.ownerId);
}

async function editAliases(asset) {
    if (!asset || asset.ownerId === PERSONA_OWNER) {
        showToast('info', '페르소나 에셋에는 별칭을 쓸 수 없어요.');
        return;
    }
    const current = getAliasesFor(asset).join(', ');
    const input = await askInput(
        `<h3><i class="fa-solid fa-at"></i> 별칭</h3>
         <p><code>${escapeHtml(asset.fileName)}</code>을(를) 다른 이름으로도 찾을 수 있게 해요. 쉼표로 여러 개 적을 수 있어요.<br>예: <code>미소, smile, 웃음</code></p>`,
        current,
        { okButton: '저장', placeholder: '별칭1, 별칭2' },
    );
    if (input === null) return;
    const list = Array.from(new Set(input.split(/[,，\n]/).map(item => item.trim()).filter(Boolean)));
    const data = getCharData(asset.ownerId);
    if (list.length) data.aliases[asset.fileName] = list;
    else delete data.aliases[asset.fileName];
    saveSettingsDebounced();
    afterLocalChange();
    showToast('success', list.length ? `별칭 ${list.length}개를 저장했어요.` : '별칭을 지웠어요.');
}

function addAlias(asset, alias) {
    if (!asset || asset.ownerId === PERSONA_OWNER) return;
    const data = getCharData(asset.ownerId);
    const list = new Set(data.aliases[asset.fileName] || []);
    list.add(String(alias).trim());
    data.aliases[asset.fileName] = Array.from(list);
    saveSettingsDebounced();
    afterLocalChange();
}

/** 이름이 바뀐 파일의 꺼짐/별칭 기록을 옮긴다 */
function migrateFileRecords(ownerId, oldName, newName) {
    if (!ownerId || ownerId === PERSONA_OWNER || oldName === newName) return;
    const data = getCharData(ownerId);
    const index = data.disabledAssets.indexOf(oldName);
    if (index >= 0) data.disabledAssets[index] = newName;
    if (data.aliases[oldName]) {
        data.aliases[newName] = data.aliases[oldName];
        delete data.aliases[oldName];
    }
}

async function renameSingleAsset(asset) {
    if (!asset || !ensureNoJob()) return;
    if (isLocked(asset)) {
        showToast('info', '에셋 링크를 쓰는 중에는 이름을 바꿀 수 없어요.');
        return;
    }
    const input = await askInput(
        `<h3><i class="fa-solid fa-pen"></i> 이름 바꾸기</h3><p><code>${escapeHtml(asset.fileName)}</code>의 새 이름을 적어 주세요. 확장자(.${escapeHtml(asset.ext)})는 그대로 둬요.</p>`,
        asset.base,
        { okButton: '바꾸기' },
    );
    if (input === null) return;
    const newBase = sanitizeBaseName(input);
    if (!newBase || newBase === asset.base) return;

    const siblings = getTargetAssets({ ownerId: asset.ownerId }).filter(item => item.key !== asset.key);
    if (siblings.some(item => item.base.toLowerCase() === newBase.toLowerCase())) {
        const overwrite = await askConfirm(`<h3>같은 이름이 있어요</h3><p><code>${escapeHtml(newBase)}</code> 파일을 덮어써요. 계속할까요?</p>`, { okButton: '덮어쓰기' });
        if (!overwrite) return;
    }

    try {
        await moveAssetFile(asset, newBase);
        migrateFileRecords(asset.ownerId, asset.fileName, `${newBase}.${asset.ext}`);
        saveSettingsDebounced();
        showToast('success', `${asset.fileName} → ${newBase}.${asset.ext}`);
    } catch (error) {
        console.error(`[${MODULE_NAME}] Rename asset error:`, error);
        showToast('error', `이름을 바꾸지 못했어요: ${describeError(error)}`);
    }
    await reloadAll();
}

async function confirmDeleteAssets(assets) {
    const list = assets.filter(Boolean);
    if (list.length === 0 || !ensureNoJob()) return;
    if (list.some(isLocked)) {
        showToast('info', '에셋 링크를 쓰는 중에는 지울 수 없어요.');
        return;
    }
    const preview = list.slice(0, 8).map(asset => `<code>${escapeHtml(asset.fileName)}</code>`).join(' ');
    const more = list.length > 8 ? ` 외 ${list.length - 8}개` : '';
    const ok = await askConfirm(
        `<h3><i class="fa-solid fa-trash-can"></i> ${list.length}개 지우기</h3>
         <p>지운 파일은 되돌릴 수 없어요.</p>
         <div class="ca-chips">${preview}${more}</div>`,
        { okButton: '삭제' },
    );
    if (!ok) return;

    const result = await runQueue(list, deleteAssetFile, { label: '지우는 중…', concurrency: 4 });
    // 지운 파일의 꺼짐/별칭 기록 정리
    list.forEach(asset => {
        if (asset.ownerId === PERSONA_OWNER) return;
        const data = getCharData(asset.ownerId);
        data.disabledAssets = data.disabledAssets.filter(name => name !== asset.fileName);
        delete data.aliases[asset.fileName];
    });
    saveSettingsDebounced();
    listState.selected.clear();
    galleryState.selected.clear();
    if (result.failed) {
        showToast('error', `${result.failed}개는 지우지 못했어요. ${describeError(result.errors[0]?.error)}`, '삭제 일부 실패');
    } else {
        showToast('success', `${result.succeeded}개를 지웠어요.`);
    }
    await reloadAll();
}

async function copyText(text) {
    try {
        await navigator.clipboard.writeText(text);
        return true;
    } catch { /* http 환경 등은 아래로 */ }
    const host = Array.from(document.querySelectorAll('dialog[open]')).pop() || document.body;
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.cssText = 'position:fixed;top:0;left:0;opacity:0;pointer-events:none;';
    host.appendChild(area);
    area.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { ok = false; }
    area.remove();
    return ok;
}

function tagFor(asset) {
    return `{{img::${asset.fileName}}}`;
}

async function copyTag(asset) {
    const tag = tagFor(asset);
    const ok = await copyText(tag);
    showToast(ok ? 'success' : 'error', ok ? `${tag} 복사했어요.` : '복사하지 못했어요.');
}

function insertTagIntoChat(asset) {
    const textarea = document.getElementById('send_textarea');
    if (!(textarea instanceof HTMLTextAreaElement)) {
        showToast('error', '채팅 입력창을 찾지 못했어요.');
        return;
    }
    const tag = tagFor(asset);
    const start = textarea.selectionStart ?? textarea.value.length;
    const end = textarea.selectionEnd ?? textarea.value.length;
    const before = textarea.value.slice(0, start);
    const after = textarea.value.slice(end);
    const glue = before && !/\s$/.test(before) ? ' ' : '';
    textarea.value = `${before}${glue}${tag}${after}`;
    const caret = before.length + glue.length + tag.length;
    textarea.setSelectionRange(caret, caret);
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    showToast('success', `채팅창에 ${tag} 넣었어요.`);
}

function downloadAsset(asset) {
    const link = document.createElement('a');
    link.href = asset.path;
    link.download = asset.fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
}

function openFileMenu(asset, anchor) {
    if (!asset) return;
    const locked = isLocked(asset);
    const persona = asset.ownerId === PERSONA_OWNER;
    const aliasCount = getAliasesFor(asset).length;
    const items = [
        { icon: 'fa-expand', label: '크게 보기', action: () => openLightboxForAsset(asset) },
        { icon: 'fa-tag', label: '태그 복사', action: () => copyTag(asset) },
        { icon: 'fa-comment-dots', label: '채팅창에 넣기', action: () => insertTagIntoChat(asset) },
        '-',
    ];
    if (!persona) {
        items.push({ icon: 'fa-at', label: aliasCount ? `별칭 (${aliasCount})` : '별칭 붙이기', action: () => editAliases(asset) });
        items.push({ icon: asset.disabled ? 'fa-eye' : 'fa-eye-slash', label: asset.disabled ? '켜기' : '끄기', action: () => toggleAsset(asset) });
    }
    items.push({ icon: 'fa-pen', label: '이름 바꾸기', disabled: locked, action: () => renameSingleAsset(asset) });
    items.push({ icon: 'fa-download', label: '파일 받기', action: () => downloadAsset(asset) });
    items.push('-');
    items.push({ icon: 'fa-trash-can', label: '삭제', danger: true, disabled: locked, action: () => confirmDeleteAssets([asset]) });
    openMenu(anchor, items, { title: asset.fileName });
}

/* =========================================================
   더보기 메뉴 (넓은 화면: 말풍선, 좁은 화면: 바텀 시트)
   ========================================================= */

let activeMenu = null;

function closeMenu() {
    if (!activeMenu) return;
    const { dialog, anchor, onClose } = activeMenu;
    activeMenu = null;
    try { if (dialog.open) dialog.close(); } catch { /* 무시 */ }
    dialog.remove();
    onClose?.();
    if (anchor?.isConnected) anchor.focus({ preventScroll: true });
}

/**
 * @param {HTMLElement} anchor
 * @param {Array<{icon?: string, label: string, action: Function, danger?: boolean, disabled?: boolean}|'-'>} items
 */
function openMenu(anchor, items, { title = '', onClose = null } = {}) {
    closeMenu();
    const dialog = document.createElement('dialog');
    dialog.className = 'ca-menu ca-scope';
    dialog.setAttribute('aria-label', title || '메뉴');
    applyScope(dialog);
    shieldFromDrawerClose(dialog);

    const narrow = window.matchMedia('(max-width: 640px)').matches;
    if (narrow) dialog.classList.add('is-sheet');

    const parts = [];
    if (title) parts.push(`<div class="ca-menu__title">${escapeHtml(title)}</div>`);
    const actions = [];
    items.forEach(item => {
        if (item === '-') {
            parts.push('<div class="ca-menu__sep" role="separator"></div>');
            return;
        }
        const index = actions.push(item) - 1;
        parts.push(`<button type="button" class="ca-menu__item${item.danger ? ' ca-menu__item--danger' : ''}" role="menuitem" data-index="${index}"${item.disabled ? ' disabled' : ''}><i class="fa-solid ${escapeHtml(item.icon || 'fa-circle')}" aria-hidden="true"></i><span>${escapeHtml(item.label)}</span></button>`);
    });
    dialog.innerHTML = `<div role="menu">${parts.join('')}</div>`;
    document.body.appendChild(dialog);

    activeMenu = { dialog, anchor, onClose };

    dialog.addEventListener('click', (event) => {
        const button = event.target instanceof Element ? event.target.closest('.ca-menu__item') : null;
        if (button) {
            const item = actions[Number(button.dataset.index)];
            closeMenu();
            if (item && !item.disabled) setTimeout(() => item.action(), 0);
            return;
        }
        // 바깥(배경) 누르면 닫기
        const rect = dialog.getBoundingClientRect();
        const inside = event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom;
        if (!inside) closeMenu();
    });
    dialog.addEventListener('cancel', (event) => {
        event.preventDefault();
        closeMenu();
    });
    dialog.addEventListener('keydown', (event) => {
        const buttons = Array.from(dialog.querySelectorAll('.ca-menu__item:not([disabled])'));
        const index = buttons.indexOf(document.activeElement);
        if (event.key === 'ArrowDown') {
            event.preventDefault();
            buttons[(index + 1) % buttons.length]?.focus();
        } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            buttons[(index - 1 + buttons.length) % buttons.length]?.focus();
        } else if (event.key === 'Home') {
            event.preventDefault();
            buttons[0]?.focus();
        } else if (event.key === 'End') {
            event.preventDefault();
            buttons[buttons.length - 1]?.focus();
        } else if (event.key === 'Tab') {
            closeMenu();
        }
    });

    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');

    if (!narrow && anchor) {
        const rect = anchor.getBoundingClientRect();
        const width = dialog.offsetWidth;
        const height = dialog.offsetHeight;
        let left = rect.right - width;
        let top = rect.bottom + 6;
        left = clamp(left, 8, window.innerWidth - width - 8);
        if (top + height > window.innerHeight - 8) top = Math.max(8, rect.top - height - 6);
        dialog.style.left = `${left}px`;
        dialog.style.top = `${top}px`;
    }
    dialog.querySelector('.ca-menu__item:not([disabled])')?.focus({ preventScroll: true });
}

/* =========================================================
   에셋 목록
   ========================================================= */

const listState = {
    query: '',
    selectMode: false,
    selected: new Set(),
    expandedCards: new Set(),
    collapsedMembers: new Set(),
    visibleKeys: [],
};

function assetMatchesFilter(asset, filter, query) {
    if (filter === 'on' && asset.disabled) return false;
    if (filter === 'off' && !asset.disabled) return false;
    if (!query) return true;
    if (asset.fileName.toLowerCase().includes(query) || asset.card.includes(query)) return true;
    return getAliasesFor(asset).some(alias => alias.toLowerCase().includes(query));
}

function buildCards(assets, filter, query, sort) {
    const map = new Map();
    for (const asset of assets) {
        if (!map.has(asset.card)) map.set(asset.card, { key: asset.card, ownerId: asset.ownerId, files: [], visible: [], mtime: 0 });
        const card = map.get(asset.card);
        card.files.push(asset);
        card.mtime = Math.max(card.mtime, asset.mtime);
        if (assetMatchesFilter(asset, filter, query)) card.visible.push(asset);
    }
    const cards = Array.from(map.values()).filter(card => card.visible.length > 0);
    if (sort === 'recent') cards.sort((a, b) => b.mtime - a.mtime || naturalCompare(a.key, b.key));
    else if (sort === 'files') cards.sort((a, b) => b.files.length - a.files.length || naturalCompare(a.key, b.key));
    else cards.sort((a, b) => naturalCompare(a.key, b.key));
    return cards;
}

function fileRowHtml(asset) {
    const aliases = getAliasesFor(asset);
    const aliasBadge = aliases.length
        ? `<span class="ca-file__alias" title="별칭: ${escapeHtml(aliases.join(', '))}">@${aliases.length}</span>`
        : '';
    const state = asset.disabled ? '꺼짐 · 눌러서 켜기' : '켜짐 · 눌러서 끄기';
    return `<li class="ca-file${asset.disabled ? ' is-off' : ''}" data-key="${escapeHtml(asset.key)}">
        <span class="ca-file__name" title="${escapeHtml(asset.fileName)}">${escapeHtml(asset.fileName)}</span>
        ${aliasBadge}
        <button type="button" class="ca-mini-btn" data-action="toggle" aria-pressed="${asset.disabled ? 'false' : 'true'}" aria-label="${escapeHtml(asset.fileName)} 사용" title="${state}"><i class="fa-solid ${asset.disabled ? 'fa-eye-slash' : 'fa-eye'}" aria-hidden="true"></i></button>
        <button type="button" class="ca-mini-btn" data-action="menu" aria-haspopup="menu" aria-label="${escapeHtml(asset.fileName)} 메뉴" title="더보기"><i class="fa-solid fa-ellipsis-vertical" aria-hidden="true"></i></button>
    </li>`;
}

function cardHtml(card) {
    const cardId = `${card.ownerId}/${card.key}`;
    const primary = card.files.find(file => !file.disabled) || card.files[0];
    const allOff = card.files.every(file => file.disabled);
    const selectedAll = card.visible.every(file => listState.selected.has(file.key));
    const expanded = listState.expandedCards.has(cardId);
    const shown = expanded ? card.visible : card.visible.slice(0, 3);
    const hiddenCount = card.visible.length - shown.length;
    const classes = ['ca-asset-card'];
    if (allOff) classes.push('is-off');
    if (listState.selectMode && selectedAll) classes.push('is-selected');

    return `<article class="${classes.join(' ')}" data-card="${escapeHtml(cardId)}">
        <div class="ca-asset-card__media">
            <button type="button" class="ca-thumb-btn" data-action="preview" data-key="${escapeHtml(primary.key)}" aria-label="${escapeHtml(card.key)} 크게 보기">
                <img src="${escapeHtml(primary.path)}" alt="" loading="lazy" decoding="async">
            </button>
            ${card.files.length > 1 ? `<span class="ca-badge ca-badge--count" aria-hidden="true"><i class="fa-solid fa-layer-group"></i>${card.files.length}</span>` : ''}
            ${allOff ? '<span class="ca-badge ca-badge--off">꺼짐</span>' : ''}
            <label class="ca-asset-card__check"><input type="checkbox" class="keyword-checkbox" data-card="${escapeHtml(cardId)}"${selectedAll ? ' checked' : ''} aria-label="${escapeHtml(card.key)} 선택"></label>
        </div>
        <div class="ca-asset-card__body">
            <div class="ca-asset-card__title"><span class="ca-asset-card__name" title="${escapeHtml(card.key)}">${escapeHtml(card.key)}</span></div>
            <ul class="ca-files">${shown.map(fileRowHtml).join('')}</ul>
            ${hiddenCount > 0 ? `<button type="button" class="ca-more-files" data-action="expand" data-card="${escapeHtml(cardId)}">+${hiddenCount}개 더 보기</button>` : ''}
        </div>
    </article>`;
}

function emptyHtml(icon, title, body) {
    return `<div class="ca-empty"><div class="ca-empty__icon"><i class="fa-solid ${icon}" aria-hidden="true"></i></div><strong>${title}</strong>${body}</div>`;
}

function skeletonHtml(count = 6) {
    return Array.from({ length: count }, () => '<div class="ca-skeleton" aria-hidden="true"></div>').join('');
}

const cardIndex = new Map();

function renderAssetList() {
    const list = document.getElementById('character_assets_list');
    if (!list) return;
    const ui = getUiSettings();
    list.classList.toggle('is-list', ui.view === 'list');
    list.classList.toggle('is-selecting', listState.selectMode);
    list.setAttribute('aria-busy', store.loading ? 'true' : 'false');

    if (store.loading && !store.ready) {
        list.innerHTML = skeletonHtml();
        return;
    }

    const all = getOwnerAssets();
    const offCount = all.filter(asset => asset.disabled).length;
    $('#ca_filter_seg [data-count="all"]').text(all.length);
    $('#ca_filter_seg [data-count="on"]').text(all.length - offCount);
    $('#ca_filter_seg [data-count="off"]').text(offCount);

    cardIndex.clear();
    listState.visibleKeys = [];

    if (store.mode === 'none') {
        list.innerHTML = emptyHtml('fa-user-plus', '캐릭터를 선택해 주세요', '<p>채팅을 열면 그 캐릭터의 에셋을 여기서 관리할 수 있어요.</p>');
        updateBulkbar();
        return;
    }

    const query = listState.query.trim().toLowerCase();
    const filter = ui.filter;
    let html = '';
    let shownCards = 0;

    const renderOwnerCards = (owner) => {
        const cards = buildCards(owner.assets, filter, query, ui.sort);
        cards.forEach(card => {
            cardIndex.set(`${card.ownerId}/${card.key}`, card);
            card.visible.forEach(asset => listState.visibleKeys.push(asset.key));
        });
        shownCards += cards.length;
        return cards;
    };

    if (store.mode === 'group') {
        for (const owner of store.owners.values()) {
            const cards = renderOwnerCards(owner);
            const open = !listState.collapsedMembers.has(owner.id);
            const avatar = owner.avatar ? `<img src="${escapeHtml(Script.getThumbnailUrl ? Script.getThumbnailUrl('avatar', owner.avatar) : `/thumbnail?type=avatar&file=${encodeURIComponent(owner.avatar)}`)}" alt="" loading="lazy">` : '';
            html += `<section class="ca-member" data-owner="${escapeHtml(owner.id)}">
                <button type="button" class="ca-member__head" data-action="member" aria-expanded="${open}">
                    <span class="ca-member__avatar">${avatar}</span>
                    <span class="ca-member__name">${escapeHtml(owner.name)}</span>
                    <span class="ca-member__count">${owner.assets.length}개${isAssetLinkActive(owner.id) ? ' · 링크' : ''}</span>
                    <i class="fa-solid fa-chevron-down ca-chevron" aria-hidden="true"></i>
                </button>
                ${open ? `<div class="ca-member__body">${cards.length ? cards.map(cardHtml).join('') : emptyHtml('fa-image', '에셋이 없어요', '')}</div>` : ''}
            </section>`;
        }
    } else {
        const owner = getSingleOwner();
        if (owner) html = renderOwnerCards(owner).map(cardHtml).join('');
    }

    if (shownCards === 0 && store.mode === 'single') {
        if (all.length === 0) {
            html = emptyHtml('fa-images', '아직 에셋이 없어요', '<p>위에서 이미지나 ZIP을 올려 보세요.<br>파일명이 AI가 쓸 키워드가 돼요. 예: <code>joy.png</code>, <code>angry_1.webp</code></p>');
        } else {
            html = emptyHtml('fa-magnifying-glass', '조건에 맞는 에셋이 없어요', '<p>검색어나 필터를 바꿔 보세요.</p>');
        }
    }

    list.innerHTML = html;
    updateBulkbar();
}

function updateBulkbar() {
    const $bar = $('#ca_bulkbar');
    $bar.prop('hidden', !listState.selectMode);
    // 사라진 파일은 선택에서 뺀다
    for (const key of listState.selected) {
        if (!store.byKey.has(key)) listState.selected.delete(key);
    }
    const count = listState.selected.size;
    $('#ca_bulk_count').text(`${count}개 선택`);
    const visible = listState.visibleKeys;
    const allChecked = visible.length > 0 && visible.every(key => listState.selected.has(key));
    $('#select_all_keywords').prop('checked', allChecked).prop('indeterminate', !allChecked && visible.some(key => listState.selected.has(key)));
    $bar.find('[data-bulk]').prop('disabled', count === 0);
}

function setSelectMode(on) {
    listState.selectMode = on;
    if (!on) listState.selected.clear();
    $('#ca_select_toggle').attr('aria-pressed', on ? 'true' : 'false');
    renderAssetList();
}

function selectedAssets() {
    return Array.from(listState.selected).map(key => store.byKey.get(key)).filter(Boolean);
}

function toggleCardSelection(cardId, force) {
    const card = cardIndex.get(cardId);
    if (!card) return;
    const on = typeof force === 'boolean' ? force : !card.visible.every(asset => listState.selected.has(asset.key));
    card.visible.forEach(asset => (on ? listState.selected.add(asset.key) : listState.selected.delete(asset.key)));
    renderAssetList();
}

function openAssetsMoreMenu(anchor) {
    const owner = getSingleOwner();
    const locked = owner ? isAssetLinkActive(owner.id) : true;
    const hasAssets = getOwnerAssets().length > 0;
    openMenu(anchor, [
        { icon: 'fa-table-cells-large', label: '갤러리로 보기', action: () => openGallery() },
        { icon: 'fa-arrows-rotate', label: '새로고침', action: async () => { await reloadAll(); showToast('success', '목록을 새로 불러왔어요.'); } },
        '-',
        { icon: 'fa-eye', label: '전부 켜기', disabled: !hasAssets, action: () => setAssetsDisabled(getOwnerAssets(), false) },
        { icon: 'fa-eye-slash', label: '전부 끄기', disabled: !hasAssets, action: () => setAssetsDisabled(getOwnerAssets(), true) },
        { icon: 'fa-copy', label: '키워드 목록 복사', disabled: !hasAssets, action: async () => { const ok = await copyText(autoGeneratedKeywords); showToast(ok ? 'success' : 'error', ok ? '켜진 파일명 목록을 복사했어요.' : '복사하지 못했어요.'); } },
        '-',
        { icon: 'fa-broom', label: '이름 정돈', disabled: !owner || locked || !hasAssets, action: () => openSmartRenamePopup() },
        { icon: 'fa-file-zipper', label: '에셋 ZIP 받기', disabled: !hasAssets, action: () => exportAssetsAsZip() },
    ], { title: '에셋 도구' });
}

/* =========================================================
   상단 요약 / 시작하기 / 에셋 폴더 정보
   ========================================================= */

function thumbnailUrl(type, file) {
    if (typeof Script.getThumbnailUrl === 'function') return Script.getThumbnailUrl(type, file);
    return `/thumbnail?type=${type}&file=${encodeURIComponent(file)}`;
}

function setAvatar(element, html) {
    if (!element) return;
    if (element.dataset.caAvatar === html) return;
    element.dataset.caAvatar = html;
    element.innerHTML = html;
}

function renderHero() {
    const avatar = document.getElementById('ca_hero_avatar');
    const $name = $('#ca_hero_name');
    const $meta = $('#ca_hero_meta');
    const $chips = $('#ca_hero_chips');

    if (store.mode === 'none') {
        setAvatar(avatar, '<i class="fa-solid fa-user"></i>');
        $name.text('캐릭터를 선택해 주세요');
        $meta.text('채팅을 열면 에셋 현황이 여기에 보여요.');
        $chips.empty();
        return;
    }

    const all = getOwnerAssets();
    const off = all.filter(asset => asset.disabled).length;
    const keywords = new Set(all.map(asset => `${asset.ownerId}/${asset.card}`)).size;
    const chips = [
        `<span class="ca-chip ca-chip--accent"><i class="fa-solid fa-image" aria-hidden="true"></i>파일 ${all.length}</span>`,
        `<span class="ca-chip"><i class="fa-solid fa-tag" aria-hidden="true"></i>키워드 ${keywords}</span>`,
    ];
    if (off) chips.push(`<span class="ca-chip ca-chip--muted"><i class="fa-solid fa-eye-slash" aria-hidden="true"></i>꺼짐 ${off}</span>`);

    if (store.mode === 'group') {
        setAvatar(avatar, '<i class="fa-solid fa-users"></i>');
        $name.text(getGroupName());
        $meta.text(`그룹 멤버 ${store.owners.size}명의 에셋을 함께 써요.`);
    } else {
        const owner = getSingleOwner();
        const character = getCurrentCharacter();
        setAvatar(avatar, character?.avatar ? `<img src="${escapeHtml(thumbnailUrl('avatar', character.avatar))}" alt="">` : '<i class="fa-solid fa-user"></i>');
        $name.text(character?.name || owner?.name || '');
        $meta.text(`에셋 폴더 · ${owner?.folder || ''}`);
        if (owner?.linked) chips.push(`<span class="ca-chip ca-chip--accent"><i class="fa-solid fa-link" aria-hidden="true"></i>${escapeHtml(getOwnerName(owner.linked))} 링크</span>`);
        if (owner?.version) chips.push(`<span class="ca-chip"><i class="fa-solid fa-layer-group" aria-hidden="true"></i>${escapeHtml(owner.version)}</span>`);
    }
    if (getInjectSettings().enabled) chips.push('<span class="ca-chip"><i class="fa-solid fa-feather-pointed" aria-hidden="true"></i>자동 삽입</span>');
    $chips.html(chips.join(''));
}

function detectRegexConflict() {
    const scripts = [];
    const global = extension_settings?.regex;
    if (Array.isArray(global)) scripts.push(...global);
    const character = getCurrentCharacter();
    const scoped = character?.data?.extensions?.regex_scripts;
    if (Array.isArray(scoped)) scripts.push(...scoped);
    return scripts.some(script => script && !script.disabled && /img::/i.test(String(script.findRegex || '')));
}

function renderSetup() {
    const ui = getUiSettings();
    const $setup = $('#ca_setup');
    if (store.mode === 'none' || ui.setupHidden) {
        $setup.prop('hidden', true);
        return;
    }
    const steps = {
        assets: getOwnerAssets().length > 0,
        render: isBuiltinRendererEnabled() || detectRegexConflict(),
        prompt: getInjectSettings().enabled || ui.promptLinked,
    };
    const done = Object.values(steps).filter(Boolean).length;
    Object.entries(steps).forEach(([key, value]) => $setup.find(`[data-step="${key}"]`).toggleClass('is-done', value));
    $('#ca_setup_progress').text(`${done} / 3`);
    $setup.prop('hidden', done === 3);
}

function renderSourceInfo() {
    const character = getCurrentCharacter();
    const $details = $('#ca_source_details');
    $details.prop('hidden', store.mode !== 'single');
    if (!character) return;
    const id = getCharId(character);
    const data = getCharData(id);
    const parts = [];
    if (data.linkedCharacter) parts.push(`${getOwnerName(data.linkedCharacter)} 링크`);
    if (data.activeAssetPreset) parts.push(`버전 ${data.activeAssetPreset}`);
    $('#ca_source_value').text(parts.length ? parts.join(' · ') : '기본 폴더').toggleClass('is-active', parts.length > 0);

    const locked = isAssetLinkActive(id);
    $('#ca_dropzone').toggleClass('is-locked', locked);
    $('#character_assets_upload_image_btn, #character_assets_upload_zip_btn, #ca_upload_url_btn, #smart_rename_btn')
        .toggleClass('disabled', locked)
        .attr('aria-disabled', locked ? 'true' : 'false');
}

function populateAssetLinkSelect() {
    const $select = $('#asset_link_select');
    $select.find('option:not(:first)').remove();
    const currentId = getCurrentCharId();
    if (!currentId) return;

    const seen = new Set();
    const options = [];
    characters.forEach(character => {
        const id = getCharId(character);
        if (!id || id === currentId || seen.has(id)) return;
        seen.add(id);
        options.push({ id, name: character.name || id });
    });
    options.sort((a, b) => naturalCompare(a.name, b.name));
    const fragment = document.createDocumentFragment();
    options.forEach(({ id, name }) => {
        const option = document.createElement('option');
        option.value = id;
        option.textContent = name === id ? name : `${name} (${id})`;
        fragment.appendChild(option);
    });
    $select[0].appendChild(fragment);

    const linked = getCharData(currentId).linkedCharacter || '';
    $select.val(linked);
    updateAssetLinkInfo(linked);
}

function updateAssetLinkInfo(linkedName) {
    const $info = $('#asset_link_info');
    if (linkedName) {
        $info.html(`<i class="fa-solid fa-link"></i> <strong>${escapeHtml(getOwnerName(linkedName))}</strong>의 에셋을 같이 쓰는 중이에요. 이 상태에선 올리기·삭제가 잠겨요.`);
    } else {
        $info.text('');
    }
}

function populateAssetPresetSelect() {
    const $select = $('#asset_preset_select');
    $select.find('option:not(:first)').remove();
    const currentId = getCurrentCharId();
    if (!currentId) return;
    const data = getCharData(currentId);
    data.assetPresets.forEach(preset => $select.append($('<option></option>').val(preset).text(preset)));
    $select.val(data.activeAssetPreset || '');
    updateAssetPresetInfo(data.activeAssetPreset);
}

function updateAssetPresetInfo(presetName) {
    const $info = $('#asset_preset_info');
    if (presetName) {
        $info.html(`<i class="fa-solid fa-layer-group"></i> 지금 <strong>${escapeHtml(presetName)}</strong> 버전을 쓰고 있어요.`);
    } else {
        $info.text('');
    }
}

function renderPersonaStatus() {
    const $status = $('#persona_assets_status');
    const persona = store.persona;
    if (!persona.name) {
        $status.html('<i class="fa-solid fa-circle-info" aria-hidden="true"></i><span>페르소나가 설정되어 있지 않아요.</span>');
        $('#persona_assets_gallery_btn').addClass('disabled');
        return;
    }
    const displayName = getContext().name1 || persona.name;
    const avatar = persona.avatar ? `<img src="${escapeHtml(thumbnailUrl('persona', persona.avatar))}" alt="">` : '';
    $status.html(`${avatar}<span class="ca-persona__name">${escapeHtml(displayName)}</span><span class="ca-chip ca-chip--accent">${persona.assets.length}개</span>`);
    $('#persona_assets_gallery_btn').toggleClass('disabled', persona.assets.length === 0);
}

function updateRegexConflict() {
    $('#ca_regex_conflict').prop('hidden', !(isBuiltinRendererEnabled() && detectRegexConflict()));
}

function renderAll() {
    renderHero();
    renderSetup();
    renderSourceInfo();
    renderAssetList();
    renderPersonaStatus();
    renderPreview();
    updateRegexConflict();
    if (galleryState.open) renderGallery();
}

/* =========================================================
   전체 새로고침 흐름
   ========================================================= */

async function reloadAll() {
    const viewKey = isGroupMode() ? `g:${selected_group}` : `c:${getCurrentCharId()}`;
    if (viewKey !== store.viewKey) {
        store.viewKey = viewKey;
        store.ready = false;
    }
    store.loading = true;
    if (!store.ready) renderAssetList();

    const ok = await refreshStore();
    if (!ok) return;
    renderAll();
    updatePromptInjection();
    syncLegacyArgMacros();
    refreshChatAssets();
}

async function onContextChanged() {
    const id = getCurrentCharId();
    if (id) {
        initializeCharacterAssets(id);
        validateLinkedCharacter(id);
    }
    listState.selected.clear();
    listState.expandedCards.clear();
    populateAssetLinkSelect();
    populateAssetPresetSelect();
    await reloadAll();
}

/* =========================================================
   에셋 링크 / 버전
   ========================================================= */

async function onAssetLinkChanged(value) {
    const id = getCurrentCharId();
    if (!id) return;
    getCharData(id).linkedCharacter = value || '';
    validateLinkedCharacter(id);
    saveSettingsDebounced();
    updateAssetLinkInfo(getCharData(id).linkedCharacter);
    await reloadAll();
}

async function addAssetVersion() {
    const id = getCurrentCharId();
    if (!id) return;
    const name = await askInput('<h3><i class="fa-solid fa-layer-group"></i> 새 에셋 버전</h3><p>하위 폴더가 만들어지고, 그 안에 따로 에셋을 올릴 수 있어요.</p>', '', { okButton: '만들기' });
    if (!name || !name.trim()) return;
    const trimmed = sanitizeBaseName(name);
    const data = getCharData(id);
    if (data.assetPresets.includes(trimmed)) {
        showToast('warning', `'${trimmed}' 버전이 이미 있어요.`);
        return;
    }
    data.assetPresets.push(trimmed);
    data.activeAssetPreset = trimmed;
    saveSettingsDebounced();
    populateAssetPresetSelect();
    await reloadAll();
    showToast('success', `'${trimmed}' 버전을 만들었어요. 에셋을 올려 주세요.`);
}

async function renameAssetVersion() {
    const id = getCurrentCharId();
    if (!id || !ensureNoJob()) return;
    const data = getCharData(id);
    const current = data.activeAssetPreset;
    if (!current) {
        showToast('info', '기본 버전은 이름을 바꿀 수 없어요.');
        return;
    }
    const input = await askInput(`<h3><i class="fa-solid fa-pen"></i> 버전 이름 바꾸기</h3><p>'${escapeHtml(current)}' 버전의 새 이름을 적어 주세요.</p>`, current, { okButton: '바꾸기' });
    if (!input || !input.trim() || input.trim() === current) return;
    const trimmed = sanitizeBaseName(input);
    if (data.assetPresets.includes(trimmed)) {
        showToast('warning', `'${trimmed}' 버전이 이미 있어요.`);
        return;
    }

    const baseName = data.linkedCharacter || id;
    const assets = getSingleOwner()?.assets || [];
    if (assets.length > 0) {
        const ok = await askConfirm(`<h3>버전 이름 바꾸기</h3><p>'${escapeHtml(current)}' → '${escapeHtml(trimmed)}'<br>파일 ${assets.length}개를 새 폴더로 옮겨요. 계속할까요?</p>`, { okButton: '바꾸기' });
        if (!ok) return;
        const result = await runQueue(assets, asset => moveAssetFile(asset, asset.base, `${baseName}/${trimmed}`), { label: '버전 폴더 옮기는 중…' });
        if (result.failed) showToast('error', `${result.failed}개 파일은 옮기지 못했어요.`);
    }

    const index = data.assetPresets.indexOf(current);
    if (index >= 0) data.assetPresets[index] = trimmed;
    data.activeAssetPreset = trimmed;
    saveSettingsDebounced();
    populateAssetPresetSelect();
    await reloadAll();
    showToast('success', `'${current}' → '${trimmed}'(으)로 바꿨어요.`);
}

async function deleteAssetVersion() {
    const id = getCurrentCharId();
    if (!id || !ensureNoJob()) return;
    const data = getCharData(id);
    const current = data.activeAssetPreset;
    if (!current) {
        showToast('info', '기본 버전은 지울 수 없어요.');
        return;
    }
    const assets = getSingleOwner()?.assets || [];
    const ok = await askConfirm(`<h3><i class="fa-solid fa-trash-can"></i> '${escapeHtml(current)}' 버전 지우기</h3><p>이 버전에 들어 있는 파일 ${assets.length}개가 모두 지워져요.</p>`, { okButton: '삭제' });
    if (!ok) return;
    if (assets.length) await runQueue(assets, deleteAssetFile, { label: '버전 지우는 중…', concurrency: 4 });
    const index = data.assetPresets.indexOf(current);
    if (index >= 0) data.assetPresets.splice(index, 1);
    data.activeAssetPreset = '';
    saveSettingsDebounced();
    populateAssetPresetSelect();
    await reloadAll();
    showToast('success', `'${current}' 버전을 지웠어요.`);
}

/* =========================================================
   이름 정돈
   ========================================================= */

const SMART_RENAME_OPTIONS = [
    { id: 'spaceToUnderscore', label: '공백 → 언더바(_)', hint: '파일명 공백을 언더바로', default: true },
    { id: 'removeSpecial', label: '특수문자 지우기', hint: '영문·숫자·한글·_·- 만 남겨요', default: true },
    { id: 'dotToUnderscore', label: '점(.) → 언더바(_)', hint: 'name.1 → name_1 (확장자 제외)', default: true },
    { id: 'cleanUnderscores', label: '언더바 정리', hint: '겹친 언더바, 앞뒤 언더바 지우기', default: true },
    { id: 'lowercase', label: '소문자로', hint: '영문을 모두 소문자로', default: false },
    { id: 'bareNumToUnderscore', label: '이름숫자 → 이름_숫자', hint: 'angry1 → angry_1', default: false },
];

function applyRenameRules(base, opts) {
    let name = base;
    if (opts.spaceToUnderscore) name = name.replace(/\s+/g, '_');
    if (opts.removeSpecial) name = name.replace(/[^\w가-힣ㄱ-ㅎㅏ-ㅣ.\-]/g, '');
    if (opts.dotToUnderscore) name = name.replace(/\./g, '_');
    if (opts.cleanUnderscores) name = name.replace(/_+/g, '_').replace(/^_|_$/g, '');
    if (opts.lowercase) name = name.toLowerCase();
    if (opts.bareNumToUnderscore) name = name.replace(/([a-zA-Z가-힣])(\d+)$/g, '$1_$2');
    return name;
}

function planSmartRename(assets, opts) {
    const plan = [];
    const unchanged = new Set();
    assets.forEach(asset => {
        const next = applyRenameRules(asset.base, opts);
        if (!next || next === asset.base) unchanged.add(asset.base.toLowerCase());
        else plan.push({ asset, next });
    });
    // 서버는 확장자와 상관없이 같은 이름을 덮어쓰므로 이름(소문자) 기준으로 충돌을 본다
    const taken = new Map();
    plan.forEach(item => {
        const key = item.next.toLowerCase();
        taken.set(key, (taken.get(key) || 0) + 1);
    });
    plan.forEach(item => {
        const key = item.next.toLowerCase();
        item.conflict = taken.get(key) > 1 || (unchanged.has(key) && key !== item.asset.base.toLowerCase());
    });
    return plan;
}

async function openSmartRenamePopup() {
    const owner = getSingleOwner();
    if (!owner) {
        showToast('info', '캐릭터 하나를 선택했을 때만 쓸 수 있어요.');
        return;
    }
    if (isAssetLinkActive(owner.id)) {
        showToast('info', '에셋 링크를 쓰는 중에는 정돈할 수 없어요.');
        return;
    }
    if (!ensureNoJob()) return;
    if (owner.assets.length === 0) {
        showToast('info', '정돈할 에셋이 없어요.');
        return;
    }

    const $content = $(`
        <div>
            <h3><i class="fa-solid fa-broom"></i> 이름 정돈</h3>
            <p>고른 규칙대로 파일명을 한 번에 바꿔요. 바뀔 이름을 아래에서 먼저 확인할 수 있어요.</p>
            <div class="ca-switch-list">
                ${SMART_RENAME_OPTIONS.map(opt => `
                    <label class="ca-switch ca-switch--block">
                        <input type="checkbox" data-opt="${opt.id}"${opt.default ? ' checked' : ''}>
                        <span class="ca-switch__track" aria-hidden="true"></span>
                        <span class="ca-switch__text"><strong>${opt.label}</strong><small>${opt.hint}</small></span>
                    </label>`).join('')}
            </div>
            <ul class="ca-rename-list" aria-live="polite"></ul>
            <p class="ca-rename-summary"></p>
        </div>`);

    const readOptions = (root) => Object.fromEntries(SMART_RENAME_OPTIONS.map(opt => [opt.id, root.find(`[data-opt="${opt.id}"]`).prop('checked')]));
    const updatePreview = () => {
        const plan = planSmartRename(owner.assets, readOptions($content));
        const $list = $content.find('.ca-rename-list');
        if (plan.length === 0) {
            $list.html('<li>바뀌는 파일이 없어요.</li>');
        } else {
            $list.html(plan.slice(0, 200).map(item => `
                <li class="${item.conflict ? 'is-conflict' : ''}">
                    <span class="from">${escapeHtml(item.asset.fileName)}</span>
                    <i class="fa-solid fa-arrow-right ca-rename-arrow" aria-hidden="true"></i>
                    <span class="to">${escapeHtml(item.next)}.${escapeHtml(item.asset.ext)}</span>
                    ${item.conflict ? '<small>· 이름이 겹쳐서 건너뛰어요</small>' : ''}
                </li>`).join('') + (plan.length > 200 ? `<li>… 외 ${plan.length - 200}개</li>` : ''));
        }
        const conflicts = plan.filter(item => item.conflict).length;
        $content.find('.ca-rename-summary').text(`바뀌는 파일 ${plan.length - conflicts}개${conflicts ? ` · 겹쳐서 건너뛰는 파일 ${conflicts}개` : ''}`);
    };
    $content.on('change', 'input[data-opt]', updatePreview);
    updatePreview();

    const { ok, root } = await confirmWithContent($content, { okButton: '적용', wide: true });
    if (!ok) return;
    const plan = planSmartRename(owner.assets, readOptions(root.length ? root : $content)).filter(item => !item.conflict);
    if (plan.length === 0) {
        showToast('info', '바꿀 파일이 없어요.');
        return;
    }

    const result = await runQueue(plan, async (item) => {
        await moveAssetFile(item.asset, item.next);
        migrateFileRecords(owner.id, item.asset.fileName, `${item.next}.${item.asset.ext}`);
    }, { label: '이름 정돈하는 중…', concurrency: 2 });
    saveSettingsDebounced();
    showToast(result.failed ? 'warning' : 'success', `정돈 완료: ${result.succeeded}개 변경${result.failed ? `, ${result.failed}개 실패` : ''}`);
    await reloadAll();
}

/* =========================================================
   ZIP 내보내기
   ========================================================= */

async function exportAssetsAsZip(assetsOverride, nameOverride) {
    if (!ensureNoJob()) return;
    const assets = assetsOverride || getOwnerAssets();
    if (assets.length === 0) {
        showToast('info', '내보낼 에셋이 없어요.');
        return;
    }
    const JSZip = await loadJSZip();
    if (!JSZip) {
        showToast('error', 'ZIP 도구를 불러오지 못했어요.');
        return;
    }
    const zip = new JSZip();
    const multipleOwners = new Set(assets.map(asset => asset.ownerId)).size > 1;
    const result = await runQueue(assets, async (asset) => {
        const blob = await fetchAssetBlob(asset);
        const folder = multipleOwners ? `${sanitizeBaseName(getOwnerName(asset.ownerId))}/` : '';
        zip.file(`${folder}${asset.fileName}`, blob);
    }, { label: 'ZIP 만드는 중…', concurrency: 4 });
    if (result.cancelled) return;

    try {
        const content = await zip.generateAsync({ type: 'blob' });
        const baseName = nameOverride || (store.mode === 'group' ? getGroupName() : (getSingleOwner()?.id || 'assets'));
        const url = URL.createObjectURL(content);
        const link = document.createElement('a');
        link.href = url;
        link.download = `${sanitizeBaseName(baseName)}_assets_${new Date().toISOString().slice(0, 10)}.zip`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 5000);
        showToast('success', `${result.succeeded}개 에셋을 ZIP으로 받았어요.`);
    } catch (error) {
        console.error(`[${MODULE_NAME}] ZIP export error:`, error);
        showToast('error', 'ZIP을 만드는 중 오류가 났어요.');
    }
}

/* =========================================================
   갤러리
   ========================================================= */

const galleryState = {
    open: false,
    source: '',
    selectMode: false,
    selected: new Set(),
    items: [],
};

function gallerySources() {
    const sources = [];
    if (store.mode === 'group') {
        sources.push({ value: 'all', label: '멤버 전체' });
        store.owners.forEach(owner => sources.push({ value: owner.id, label: owner.name }));
    } else if (store.mode === 'single') {
        const owner = getSingleOwner();
        if (owner) sources.push({ value: owner.id, label: owner.name });
    }
    if (store.persona.name) sources.push({ value: PERSONA_OWNER, label: '페르소나' });
    return sources;
}

function galleryAssets() {
    if (galleryState.source === PERSONA_OWNER) return store.persona.assets;
    if (galleryState.source === 'all') return getOwnerAssets();
    return store.owners.get(galleryState.source)?.assets || [];
}

function galleryTarget() {
    if (galleryState.source === PERSONA_OWNER) return store.persona.folder ? { folder: store.persona.folder, ownerId: PERSONA_OWNER, title: '페르소나' } : null;
    const owner = store.owners.get(galleryState.source);
    if (!owner || isAssetLinkActive(owner.id)) return null;
    return characterTarget(owner);
}

function openGalleryModal() {
    const dialog = document.getElementById('asset_gallery_modal');
    if (!dialog) return;
    applyScope(dialog);
    if (typeof dialog.showModal === 'function') {
        if (!dialog.open) dialog.showModal();
    } else {
        dialog.setAttribute('open', '');
    }
    galleryState.open = true;
    fixToastrLayer();
}

function closeGalleryModal() {
    const dialog = document.getElementById('asset_gallery_modal');
    if (!dialog) return;
    if (typeof dialog.close === 'function' && dialog.open) dialog.close();
    else dialog.removeAttribute('open');
    galleryState.open = false;
    setGallerySelectMode(false, false);
    fixToastrLayer();
}

function openGallery(source) {
    const sources = gallerySources();
    if (sources.length === 0) {
        showToast('info', '캐릭터를 먼저 선택해 주세요.');
        return;
    }
    const wanted = source || galleryState.source;
    galleryState.source = sources.some(item => item.value === wanted) ? wanted : sources[0].value;
    const $select = $('#ca_gallery_source');
    $select.html(sources.map(item => `<option value="${escapeHtml(item.value)}">${escapeHtml(item.label)}</option>`).join(''));
    $select.val(galleryState.source).prop('hidden', sources.length < 2);
    applyGridSize(settings().gallerySettings.gridSize, false);
    $('#gallery_search').val('');
    renderGallery();
    openGalleryModal();
}

function renderGallery() {
    const container = document.getElementById('asset_gallery_container');
    if (!container) return;
    const query = String($('#gallery_search').val() || '').trim().toLowerCase();
    const assets = galleryAssets();
    const items = assets.filter(asset => !query || asset.fileName.toLowerCase().includes(query) || asset.card.includes(query) || getAliasesFor(asset).some(alias => alias.toLowerCase().includes(query)));
    galleryState.items = items;
    for (const key of galleryState.selected) {
        if (!store.byKey.has(key)) galleryState.selected.delete(key);
    }

    const source = gallerySources().find(item => item.value === galleryState.source);
    $('#ca_gallery_sub').text(`${source?.label || ''} · ${assets.length}개${query ? ` 중 ${items.length}개` : ''}`);
    container.classList.toggle('is-selecting', galleryState.selectMode);

    if (items.length === 0) {
        container.innerHTML = assets.length
            ? emptyHtml('fa-magnifying-glass', '검색 결과가 없어요', '')
            : emptyHtml('fa-images', '에셋이 없어요', '<p>여기로 이미지를 끌어다 놓으면 바로 올라가요.</p>');
    } else {
        const showOwner = galleryState.source === 'all';
        container.innerHTML = items.map((asset, index) => {
            const persona = asset.ownerId === PERSONA_OWNER;
            const selected = galleryState.selected.has(asset.key);
            return `<figure class="ca-gitem${asset.disabled ? ' is-off' : ''}${selected ? ' is-selected' : ''}" data-key="${escapeHtml(asset.key)}" data-index="${index}">
                <button type="button" class="ca-thumb-btn" data-action="open" aria-label="${escapeHtml(asset.fileName)} 크게 보기"${galleryState.selectMode ? ` aria-pressed="${selected}"` : ''}>
                    <img src="${escapeHtml(asset.path)}" alt="" loading="lazy" decoding="async">
                </button>
                <span class="ca-gitem__check" aria-hidden="true"><i class="fa-solid fa-check"></i></span>
                <div class="ca-gitem__actions">
                    <button type="button" class="ca-mini-btn" data-action="insert" aria-label="${escapeHtml(asset.fileName)} 채팅창에 넣기" title="채팅창에 넣기"><i class="fa-solid fa-comment-dots" aria-hidden="true"></i></button>
                    <button type="button" class="ca-mini-btn" data-action="copy" aria-label="${escapeHtml(asset.fileName)} 태그 복사" title="태그 복사"><i class="fa-solid fa-tag" aria-hidden="true"></i></button>
                    ${persona ? '' : `<button type="button" class="ca-mini-btn" data-action="toggle" aria-pressed="${asset.disabled ? 'false' : 'true'}" aria-label="${escapeHtml(asset.fileName)} 사용" title="${asset.disabled ? '켜기' : '끄기'}"><i class="fa-solid ${asset.disabled ? 'fa-eye-slash' : 'fa-eye'}" aria-hidden="true"></i></button>`}
                    <button type="button" class="ca-mini-btn" data-action="menu" aria-haspopup="menu" aria-label="${escapeHtml(asset.fileName)} 메뉴" title="더보기"><i class="fa-solid fa-ellipsis-vertical" aria-hidden="true"></i></button>
                </div>
                <figcaption class="ca-gitem__cap"><span title="${escapeHtml(asset.fileName)}">${escapeHtml(asset.fileName)}</span>${showOwner ? `<span class="ca-gitem__owner">${escapeHtml(getOwnerName(asset.ownerId))}</span>` : ''}</figcaption>
            </figure>`;
        }).join('');
    }
    updateGallerySelectbar();
}

function updateGallerySelectbar() {
    const count = galleryState.selected.size;
    $('#ca_gallery_selectbar').prop('hidden', !galleryState.selectMode);
    $('#gallery_select_count').text(`${count}개 선택`);
    $('#gallery_delete_selected_btn, #ca_gallery_off_selected').prop('disabled', count === 0);
    $('#ca_gallery_off_selected').prop('hidden', galleryState.source === PERSONA_OWNER);
}

function setGallerySelectMode(on, render = true) {
    galleryState.selectMode = on;
    if (!on) galleryState.selected.clear();
    $('#gallery_select_mode_btn').attr('aria-pressed', on ? 'true' : 'false');
    if (render) renderGallery();
}

/** 갤러리 그리드 크기 적용 */
function applyGridSize(size, save = true) {
    const value = ['small', 'medium', 'large'].includes(size) ? size : 'medium';
    $('#asset_gallery_container').removeClass('grid-small grid-medium grid-large').addClass(`grid-${value}`);
    $('#gallery_grid_size [data-size]').each(function () {
        const on = this.dataset.size === value;
        this.setAttribute('aria-checked', on ? 'true' : 'false');
        this.tabIndex = on ? 0 : -1;
    });
    if (save) {
        settings().gallerySettings.gridSize = value;
        saveSettingsDebounced();
    }
}

/* =========================================================
   크게 보기 (라이트박스)
   ========================================================= */

const lightbox = { dialog: null, items: [], index: 0, sizes: new Map() };

function openLightboxForAsset(asset) {
    const pool = galleryState.open && galleryState.items.some(item => item.key === asset.key)
        ? galleryState.items
        : listState.visibleKeys.map(key => store.byKey.get(key)).filter(Boolean);
    const items = pool.length ? pool : [asset];
    openLightbox(items, Math.max(0, items.findIndex(item => item.key === asset.key)));
}

function closeLightbox() {
    const dialog = lightbox.dialog;
    if (!dialog) return;
    lightbox.dialog = null;
    try { if (dialog.open) dialog.close(); } catch { /* 무시 */ }
    dialog.remove();
    fixToastrLayer();
}

function openLightbox(items, index = 0) {
    if (!items?.length) return;
    closeLightbox();
    lightbox.items = items;
    lightbox.index = clamp(index, 0, items.length - 1);

    const dialog = document.createElement('dialog');
    dialog.className = 'ca-lightbox ca-scope';
    dialog.setAttribute('aria-label', '이미지 크게 보기');
    applyScope(dialog);
    shieldFromDrawerClose(dialog);
    const multi = items.length > 1;
    dialog.innerHTML = `
        <div class="ca-lightbox__bar">
            ${multi ? '<span class="ca-lightbox__count" aria-live="polite"></span>' : ''}
            <div class="ca-lightbox__title">
                <div class="ca-lightbox__name"></div>
                <div class="ca-lightbox__meta"></div>
            </div>
            <button type="button" class="ca-lightbox__btn" data-action="copy" aria-label="태그 복사" title="태그 복사"><i class="fa-solid fa-tag" aria-hidden="true"></i></button>
            <button type="button" class="ca-lightbox__btn is-optional" data-action="insert" aria-label="채팅창에 넣기" title="채팅창에 넣기"><i class="fa-solid fa-comment-dots" aria-hidden="true"></i></button>
            <button type="button" class="ca-lightbox__btn is-optional" data-action="download" aria-label="파일 받기" title="파일 받기"><i class="fa-solid fa-download" aria-hidden="true"></i></button>
            <button type="button" class="ca-lightbox__btn" data-action="close" aria-label="닫기" title="닫기 (Esc)"><i class="fa-solid fa-xmark" aria-hidden="true"></i></button>
        </div>
        <div class="ca-lightbox__stage">
            ${multi ? '<div class="ca-lightbox__nav ca-lightbox__nav--prev"><button type="button" class="ca-lightbox__btn" data-action="prev" aria-label="이전 이미지"><i class="fa-solid fa-chevron-left" aria-hidden="true"></i></button></div>' : ''}
            <img alt="">
            ${multi ? '<div class="ca-lightbox__nav ca-lightbox__nav--next"><button type="button" class="ca-lightbox__btn" data-action="next" aria-label="다음 이미지"><i class="fa-solid fa-chevron-right" aria-hidden="true"></i></button></div>' : ''}
        </div>`;
    document.body.appendChild(dialog);
    lightbox.dialog = dialog;

    const img = dialog.querySelector('.ca-lightbox__stage img');
    img.addEventListener('load', () => updateLightboxMeta());

    dialog.addEventListener('click', (event) => {
        const target = event.target instanceof Element ? event.target : null;
        const button = target?.closest('[data-action]');
        const current = lightbox.items[lightbox.index];
        if (button) {
            const action = button.dataset.action;
            if (action === 'close') closeLightbox();
            else if (action === 'prev') navigateLightbox(-1);
            else if (action === 'next') navigateLightbox(1);
            else if (action === 'copy' && current) copyTag(current);
            else if (action === 'insert' && current) { insertTagIntoChat(current); closeLightbox(); if (galleryState.open) closeGalleryModal(); }
            else if (action === 'download' && current) downloadAsset(current);
            return;
        }
        if (target === img) {
            dialog.classList.toggle('is-zoomed');
            return;
        }
        if (target?.classList.contains('ca-lightbox__stage') || target === dialog) closeLightbox();
    });
    dialog.addEventListener('cancel', (event) => {
        event.preventDefault();
        closeLightbox();
    });
    dialog.addEventListener('keydown', (event) => {
        if (event.key === 'ArrowLeft') { event.preventDefault(); navigateLightbox(-1); }
        if (event.key === 'ArrowRight') { event.preventDefault(); navigateLightbox(1); }
    });

    // 손가락으로 넘기기
    let startX = 0;
    let startY = 0;
    let tracking = false;
    const stage = dialog.querySelector('.ca-lightbox__stage');
    stage.addEventListener('pointerdown', (event) => {
        if (event.pointerType === 'mouse' || dialog.classList.contains('is-zoomed')) return;
        tracking = true;
        startX = event.clientX;
        startY = event.clientY;
    });
    stage.addEventListener('pointerup', (event) => {
        if (!tracking) return;
        tracking = false;
        const dx = event.clientX - startX;
        const dy = event.clientY - startY;
        if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.4) navigateLightbox(dx < 0 ? 1 : -1);
    });
    stage.addEventListener('pointercancel', () => { tracking = false; });

    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
    fixToastrLayer();
    showLightboxItem();
}

function navigateLightbox(step) {
    if (lightbox.items.length < 2) return;
    lightbox.index = (lightbox.index + step + lightbox.items.length) % lightbox.items.length;
    showLightboxItem();
}

function showLightboxItem() {
    const dialog = lightbox.dialog;
    const item = lightbox.items[lightbox.index];
    if (!dialog || !item) return;
    dialog.classList.remove('is-zoomed');
    const img = dialog.querySelector('.ca-lightbox__stage img');
    img.src = item.path;
    img.alt = item.base || item.fileName;
    dialog.querySelector('.ca-lightbox__name').textContent = item.fileName;
    const count = dialog.querySelector('.ca-lightbox__count');
    if (count) count.textContent = `${lightbox.index + 1} / ${lightbox.items.length}`;
    dialog.querySelector('[data-action="insert"]').hidden = Boolean(item.pseudo);
    updateLightboxMeta();
    // 다음 이미지 미리 받아 두기
    const next = lightbox.items[(lightbox.index + 1) % lightbox.items.length];
    if (next && next !== item) new Image().src = next.path;
}

async function updateLightboxMeta() {
    const dialog = lightbox.dialog;
    const item = lightbox.items[lightbox.index];
    if (!dialog || !item) return;
    const img = dialog.querySelector('.ca-lightbox__stage img');
    const parts = [];
    if (item.ownerId) parts.push(getOwnerName(item.ownerId));
    if (img.naturalWidth) parts.push(`${img.naturalWidth}×${img.naturalHeight}`);
    if (item.ext) parts.push(item.ext.toUpperCase());
    const size = lightbox.sizes.get(item.path);
    if (size) parts.push(formatBytes(size));
    if (item.disabled) parts.push('꺼짐');
    dialog.querySelector('.ca-lightbox__meta').textContent = parts.join(' · ');

    if (!lightbox.sizes.has(item.path)) {
        lightbox.sizes.set(item.path, 0);
        try {
            const response = await fetch(item.path, { cache: 'force-cache' });
            const blob = await response.blob();
            lightbox.sizes.set(item.path, blob.size);
            if (lightbox.items[lightbox.index] === item) updateLightboxMeta();
        } catch { /* 크기 정보는 없어도 된다 */ }
    }
}

/* =========================================================
   표시 탭
   ========================================================= */

const PREVIEW_PLACEHOLDER = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="400" viewBox="0 0 300 400"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f7c6d6"/><stop offset="1" stop-color="#b9a7ee"/></linearGradient></defs><rect width="300" height="400" fill="url(#g)"/><circle cx="150" cy="160" r="56" fill="#fff" fill-opacity=".55"/><rect x="70" y="240" width="160" height="90" rx="45" fill="#fff" fill-opacity=".45"/></svg>',
);

function previewSampleAsset() {
    const sample = getActiveAssets()[0] || store.persona.assets[0];
    return sample || { base: 'sample', fileName: '', path: PREVIEW_PLACEHOLDER, placeholder: true };
}

/** 스타일 고르기 칸: 실제 틀에 지금 캐릭터 그림을 넣어 작게 보여 준다 */
function styleTileHtml(style, sample, { asRadio = true } = {}) {
    const float = style.id.startsWith('float');
    const frame = buildAssetHtml(sample, sample.base, { style: style.id, maxWidth: 64, eager: true, caption: false });
    const lines = float ? '<span class="ca-tile-lines" aria-hidden="true"><i></i><i></i><i></i><i></i></span>' : '';
    const preview = `<span class="ca-tile-pv${float ? ` is-side${style.id === 'float-right' ? ' is-right' : ''}` : ''}" aria-hidden="true">${frame}${lines}</span>`;
    if (!asRadio) return preview;
    return `<button type="button" class="ca-style-tile" role="radio" aria-checked="false" data-style="${style.id}" title="${escapeHtml(style.desc)}">
        ${preview}
        <span class="ca-style-tile__name">${escapeHtml(style.name)}</span>
        <span class="ca-style-tile__desc">${escapeHtml(style.desc)}</span>
    </button>`;
}

let styleGridSample = '';

function buildStyleGrid() {
    const sample = previewSampleAsset();
    styleGridSample = sample.path;
    $('#ca_style_grid').html(RENDER_STYLES.map(style => styleTileHtml(style, sample)).join(''));
    syncStyleGrid();
}

function syncStyleGrid() {
    const style = currentStyleId();
    $('#ca_style_grid .ca-style-tile').each(function () {
        const on = this.dataset.style === style;
        this.setAttribute('aria-checked', on ? 'true' : 'false');
        this.tabIndex = on ? 0 : -1;
    });
}

function renderPreview() {
    const preview = document.getElementById('ca_render_preview');
    if (!preview || preview.closest('.ca-panel')?.hidden) return;
    const sample = previewSampleAsset();
    // 캐릭터가 바뀌어 견본 그림이 달라졌으면 스타일 칸도 다시 그린다
    if (sample.path !== styleGridSample) {
        const focused = document.activeElement?.closest?.('#ca_style_grid') ? currentStyleId() : null;
        buildStyleGrid();
        if (focused) $(`#ca_style_grid [data-style="${focused}"]`).trigger('focus');
    }
    const html = buildAssetHtml(sample, sample.base, { eager: true });
    preview.innerHTML = `
        <span class="ca-preview__label">미리보기${sample.placeholder ? '' : ` · ${escapeHtml(sample.fileName)}`}</span>
        <p>창밖으로 노을이 번지고 있었다. 그는 잠시 말을 고르다가, 조용히 웃으며 고개를 돌렸다.</p>
        ${html}
        <p>"오늘은 조금 늦게 들어가도 괜찮지 않아?" 낮게 가라앉은 목소리가 방 안을 천천히 채웠다. 대답 대신 찻잔이 가볍게 부딪히는 소리가 났다.</p>`;
}

const refreshChatAssetsDebounced = debounce(refreshChatAssets, 150);

function syncRenderControls() {
    const s = getRendererSettings();
    $('#character_assets_builtin_renderer_enabled').prop('checked', Boolean(s.enabled));
    $('#character_assets_renderer_lazy').prop('checked', Boolean(s.lazy));
    $('#character_assets_random_asset').prop('checked', Boolean(s.randomAsset));
    $('#ca_render_zoom').prop('checked', Boolean(s.clickToZoom));
    $('#ca_render_caption').prop('checked', Boolean(s.caption));
    $('#ca_render_smart').prop('checked', Boolean(s.smartMatch));
    $('#ca_render_missing').val(s.missing);
    $('#ca_size_range').val(s.maxWidth);
    $('#ca_size_value').text(`${s.maxWidth}px`);
    syncStyleGrid();
}

/* =========================================================
   프롬프트 탭
   ========================================================= */

function getCurrentPresetId() {
    return settings().currentPresetId;
}

function getPresetById(presetId) {
    return (settings().presets || []).find(preset => preset.id === presetId) || null;
}

function getCurrentPreset() {
    return getPresetById(getCurrentPresetId());
}

function getPresetByName(name) {
    return (settings().presets || []).find(preset => preset.name === name) || null;
}

function updatePresetUI() {
    const presets = settings().presets || [];
    const currentId = getCurrentPresetId();
    const $selector = $('#prompt_preset_selector');
    $selector.empty();
    presets.forEach(preset => {
        $selector.append($('<option></option>').val(preset.id).text(preset.name).prop('selected', preset.id === currentId));
    });
    const isDefault = getCurrentPreset()?.name === DEFAULT_PRESET_NAME;
    $('#rename_preset_btn, #delete_preset_btn').prop('disabled', isDefault).toggleClass('is-disabled', isDefault);
}

function isPromptDirty() {
    const preset = getCurrentPreset();
    if (!preset) return false;
    return String($('#character_assets_image_prompt').val() ?? '') !== String(preset.prompt ?? '');
}

function updatePromptDirty() {
    const dirty = isPromptDirty();
    $('#ca_prompt_dirty').prop('hidden', !dirty);
    $('#character_assets_image_prompt').toggleClass('is-dirty', dirty);
    $('#ca_prompt_revert_btn').toggleClass('disabled', !dirty);
}

let tokenCounter = null;
const updatePromptStats = debounce(async () => {
    const text = String($('#character_assets_image_prompt').val() ?? '');
    const $stats = $('#ca_prompt_stats');
    $stats.text(`${text.length.toLocaleString()}자`);
    if (tokenCounter === null) {
        const mod = await loadModule('../../../tokenizers.js');
        tokenCounter = typeof mod?.getTokenCountAsync === 'function' ? mod.getTokenCountAsync : false;
    }
    if (tokenCounter) {
        try {
            // 매크로가 풀린 실제 길이로 센다
            const count = await tokenCounter(substituteParams(text));
            $stats.text(`${text.length.toLocaleString()}자 · 약 ${Number(count).toLocaleString()} 토큰`);
        } catch { /* 글자 수만 */ }
    }
}, 400);

function setPromptText(text) {
    $('#character_assets_image_prompt').val(text);
    settings().imagePrompt = text;
    saveSettingsDebounced();
    updatePromptDirty();
    updatePromptStats();
    updatePromptInjection();
}

function selectPreset(presetId) {
    const preset = getPresetById(presetId);
    if (!preset) return;
    settings().currentPresetId = presetId;
    updatePresetUI();
    setPromptText(preset.prompt);
}

async function onPresetSelected(presetId) {
    if (presetId === getCurrentPresetId()) return;
    if (isPromptDirty()) {
        const choice = await askChoice(
            '<h3><i class="fa-solid fa-circle-exclamation"></i> 저장하지 않은 내용이 있어요</h3><p>지금 프리셋에 고친 내용을 저장하고 넘어갈까요?</p>',
            [{ text: '저장 후 이동', value: 'save' }, { text: '버리고 이동', value: 'discard' }],
        );
        if (choice === null) {
            $('#prompt_preset_selector').val(getCurrentPresetId());
            return;
        }
        if (choice === 'save') saveCurrentPromptToPreset(false);
    }
    selectPreset(presetId);
}

function saveCurrentPromptToPreset(notify = true) {
    const preset = getCurrentPreset();
    if (!preset) return;
    const currentPrompt = String($('#character_assets_image_prompt').val() ?? '');
    preset.prompt = currentPrompt;
    settings().imagePrompt = currentPrompt;
    saveSettingsDebounced();
    updatePromptDirty();
    updatePromptInjection();
    if (notify) showToast('success', `"${preset.name}" 프리셋에 저장했어요.`);
}

async function createPreset() {
    const name = await askInput('<h3><i class="fa-solid fa-plus"></i> 새 프리셋</h3><p>지금 편집기 내용으로 새 프리셋을 만들어요.</p>', '', { okButton: '만들기' });
    if (!name || !name.trim()) return;
    let uniqueName = name.trim();
    let counter = 1;
    while (getPresetByName(uniqueName)) uniqueName = `${name.trim()} (${counter++})`;
    const preset = { id: uuidv4(), name: uniqueName, prompt: String($('#character_assets_image_prompt').val() ?? '') };
    settings().presets.push(preset);
    settings().currentPresetId = preset.id;
    saveSettingsDebounced();
    updatePresetUI();
    updatePromptDirty();
    showToast('success', `"${uniqueName}" 프리셋을 만들었어요.`);
}

async function renameCurrentPreset() {
    const preset = getCurrentPreset();
    if (!preset) return;
    if (preset.name === DEFAULT_PRESET_NAME) {
        showToast('info', '기본 프리셋은 이름을 바꿀 수 없어요.');
        return;
    }
    const newName = await askInput(`<h3><i class="fa-solid fa-pen"></i> 프리셋 이름 바꾸기</h3><p>"${escapeHtml(preset.name)}"의 새 이름을 적어 주세요.</p>`, preset.name, { okButton: '바꾸기' });
    if (!newName || !newName.trim() || newName.trim() === preset.name) return;
    if (getPresetByName(newName.trim())) {
        showToast('error', `"${newName.trim()}" 프리셋이 이미 있어요.`);
        return;
    }
    preset.name = newName.trim();
    saveSettingsDebounced();
    updatePresetUI();
    showToast('success', `이름을 "${preset.name}"(으)로 바꿨어요.`);
}

async function deleteCurrentPreset() {
    const presets = settings().presets;
    const preset = getCurrentPreset();
    if (!preset) return;
    if (preset.name === DEFAULT_PRESET_NAME) {
        showToast('info', '기본 프리셋은 지울 수 없어요.');
        return;
    }
    if (presets.length <= 1) {
        showToast('info', '마지막 프리셋은 지울 수 없어요.');
        return;
    }
    const ok = await askConfirm(`<h3><i class="fa-solid fa-trash-can"></i> 프리셋 지우기</h3><p>"${escapeHtml(preset.name)}" 프리셋을 지울까요?</p>`, { okButton: '삭제' });
    if (!ok) return;
    presets.splice(presets.indexOf(preset), 1);
    const fallback = presets.find(p => p.name === DEFAULT_PRESET_NAME) || presets[0];
    settings().currentPresetId = fallback.id;
    updatePresetUI();
    setPromptText(fallback.prompt);
    showToast('success', `"${preset.name}" 프리셋을 지웠어요.`);
}

function exportPresets() {
    const preset = getCurrentPreset();
    if (!preset) {
        showToast('warning', '내보낼 프리셋이 없어요.');
        return;
    }
    const json = JSON.stringify([preset], null, 2);
    download(json, `character-assets-preset_${preset.name}_${new Date().toISOString().replace(/[:.]/g, '-')}.json`, 'application/json');
    showToast('success', `"${preset.name}" 프리셋을 내보냈어요.`);
}

async function importPresets(file) {
    try {
        let imported;
        try {
            imported = JSON.parse(await getFileText(file));
        } catch {
            showToast('error', 'JSON 형식이 올바르지 않아요.', '불러오기 실패');
            return;
        }
        if (!Array.isArray(imported)) imported = [imported];
        const valid = imported.filter(p => p && typeof p === 'object' && typeof p.name === 'string' && p.name && typeof p.prompt === 'string' && p.prompt)
            .map(p => ({ id: typeof p.id === 'string' && p.id ? p.id : uuidv4(), name: p.name, prompt: p.prompt }));
        if (valid.length === 0) {
            showToast('error', '쓸 수 있는 프리셋이 없어요.', '불러오기 실패');
            return;
        }

        const choice = await askChoice(
            `<h3><i class="fa-solid fa-file-import"></i> 프리셋 ${valid.length}개 불러오기</h3><p>지금 목록에 더할까요, 아니면 통째로 바꿀까요?</p>`,
            [{ text: '추가', value: 'add' }, { text: '덮어쓰기', value: 'replace' }],
        );
        if (choice === null) return;

        const current = settings().presets || [];
        if (choice === 'add') {
            const ids = new Set(current.map(p => p.id));
            valid.forEach(preset => {
                if (ids.has(preset.id)) preset.id = uuidv4();
                let name = preset.name;
                let counter = 1;
                while (current.some(p => p.name === name)) name = `${preset.name} (${counter++})`;
                preset.name = name;
            });
            settings().presets = [...current, ...valid];
        } else {
            settings().presets = valid;
            if (!valid.some(p => p.id === getCurrentPresetId())) {
                settings().currentPresetId = valid[0].id;
                settings().imagePrompt = valid[0].prompt;
            }
            initializeSettings();
        }
        saveSettingsDebounced();
        updatePresetUI();
        setPromptText(getCurrentPreset()?.prompt ?? settings().imagePrompt);
        showToast('success', `프리셋 ${valid.length}개를 불러왔어요.`);
    } catch (error) {
        console.error(`[${MODULE_NAME}] Error importing presets:`, error);
        showToast('error', '프리셋을 불러오는 중 오류가 났어요.');
    }
}

function insertAtCursor(textarea, text) {
    const start = textarea.selectionStart ?? textarea.value.length;
    const end = textarea.selectionEnd ?? textarea.value.length;
    textarea.value = textarea.value.slice(0, start) + text + textarea.value.slice(end);
    const caret = start + text.length;
    textarea.focus();
    textarea.setSelectionRange(caret, caret);
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
}

async function previewPrompt() {
    const raw = String($('#character_assets_image_prompt').val() ?? '');
    let resolved = raw;
    try { resolved = substituteParams(raw); } catch { /* 그대로 */ }
    await showInfo(`<h3><i class="fa-solid fa-eye"></i> 실제로 들어가는 내용</h3><p>매크로를 지금 캐릭터 기준으로 바꿔서 보여 드려요.</p><pre class="ca-prompt-preview">${escapeHtml(resolved)}</pre>`, { wide: true });
}

function replaceKeywordsPlaceholder() {
    const owner = getSingleOwner();
    if (!owner) {
        showToast('error', '키워드를 가져오려면 캐릭터를 선택해 주세요.');
        return;
    }
    if (owner.assets.length === 0) {
        showToast('warning', '이 캐릭터에 올린 에셋이 없어요.');
        return;
    }
    const textarea = $('#character_assets_image_prompt');
    const current = String(textarea.val() ?? '');
    if (!current.includes('{{img_keywords}}')) {
        showToast('info', '지금 지침에 {{img_keywords}}가 없어요.');
        return;
    }
    setPromptText(current.replace(/\{\{img_keywords\}\}/g, owner.assets.map(asset => asset.fileName).join(', ')));
    showToast('success', '{{img_keywords}}를 실제 파일명 목록으로 바꿨어요.');
}

function openPromptMoreMenu(anchor) {
    openMenu(anchor, [
        { icon: 'fa-copy', label: '지침 복사', action: async () => { const ok = await copyText(String($('#character_assets_image_prompt').val() ?? '')); showToast(ok ? 'success' : 'error', ok ? '이미지 지침을 복사했어요.' : '복사하지 못했어요.'); } },
        { icon: 'fa-file-export', label: '프리셋 내보내기', action: exportPresets },
        { icon: 'fa-file-import', label: '프리셋 불러오기', action: () => $('#import_presets_input').trigger('click') },
        '-',
        { icon: 'fa-wand-magic-sparkles', label: '{{img_keywords}}를 실제 목록으로', action: replaceKeywordsPlaceholder },
        { icon: 'fa-rotate-left', label: '기본 지침 내용으로', action: async () => {
            const ok = await askConfirm('<h3>기본 지침으로 바꾸기</h3><p>편집기 내용을 처음 제공된 기본 지침으로 바꿔요. 저장 전까지는 프리셋에 반영되지 않아요.</p>', { okButton: '바꾸기' });
            if (ok) setPromptText(DEFAULT_IMAGE_PROMPT);
        } },
    ], { title: '이미지 지침' });
}

function syncInjectControls() {
    const inject = getInjectSettings();
    $('#ca_inject_enabled').prop('checked', Boolean(inject.enabled));
    $('#ca_inject_position').val(String(inject.position));
    $('#ca_inject_depth').val(inject.depth);
    $('#ca_inject_role').val(String(inject.role));
    $('#ca_inject_depth_field').prop('hidden', Number(inject.position) !== 1);
    $('#ca_inject_options').toggleClass('is-disabled', !inject.enabled);
}

/* =========================================================
   도구 탭
   ========================================================= */

function runChatCheck() {
    const $result = $('#ca_chat_check_result');
    if (store.mode === 'none') {
        $result.html('<p class="ca-note">캐릭터 채팅을 열어 주세요.</p>');
        return;
    }
    const chat = getContext().chat || [];
    const used = new Map();
    const missing = new Map();
    let total = 0;
    for (const message of chat) {
        const text = String(message?.mes || '');
        if (!text.includes('{{img::')) continue;
        for (const match of text.matchAll(IMG_TAG_REGEX)) {
            total++;
            const name = match[1].trim();
            const asset = resolveAsset(name, { stable: true });
            if (asset) {
                const key = `${asset.ownerId}/${asset.card}`;
                used.set(key, { asset, count: (used.get(key)?.count || 0) + 1 });
            } else {
                missing.set(name, (missing.get(name) || 0) + 1);
            }
        }
    }

    const cards = new Map();
    getActiveAssets().forEach(asset => {
        const key = `${asset.ownerId}/${asset.card}`;
        if (!cards.has(key)) cards.set(key, asset);
    });
    const unused = Array.from(cards.entries()).filter(([key]) => !used.has(key)).map(([, asset]) => asset);
    const top = Array.from(used.values()).sort((a, b) => b.count - a.count).slice(0, 6);

    let html = `<div class="ca-stats">
        <div class="ca-stat"><b>${total}</b><span>태그</span></div>
        <div class="ca-stat is-good"><b>${used.size}</b><span>쓰인 키워드</span></div>
        <div class="ca-stat${missing.size ? ' is-warn' : ''}"><b>${missing.size}</b><span>못 찾은 이름</span></div>
        <div class="ca-stat"><b>${unused.length}</b><span>안 쓰인 키워드</span></div>
    </div>`;

    if (total === 0) {
        html += '<p class="ca-note">이 채팅에는 아직 <code>{{img::}}</code> 태그가 없어요.</p>';
    }

    if (missing.size) {
        html += '<div class="ca-check__title">못 찾은 이름</div><ul class="ca-check__list">';
        Array.from(missing.entries()).sort((a, b) => b[1] - a[1]).slice(0, 20).forEach(([name, count]) => {
            const suggestions = suggestAssets(name);
            html += `<li class="ca-check__item"><code>${escapeHtml(name)}</code><small>${count}회</small>
                ${suggestions.map(asset => `<button type="button" class="ca-chip-btn" data-check-alias="${escapeHtml(name)}" data-key="${escapeHtml(asset.key)}" title="${escapeHtml(name)}을(를) ${escapeHtml(asset.fileName)}의 별칭으로 등록"><i class="fa-solid fa-link" aria-hidden="true"></i>${escapeHtml(asset.fileName)}</button>`).join('')}
                ${suggestions.length ? '' : '<small>비슷한 에셋이 없어요</small>'}
            </li>`;
        });
        html += '</ul><p class="ca-note">후보를 누르면 그 이름을 별칭으로 등록해서 다음부터 바로 찾아요.</p>';
    } else if (total > 0) {
        html += '<div class="ca-check__ok"><i class="fa-solid fa-circle-check" aria-hidden="true"></i>모든 태그가 에셋과 잘 연결돼 있어요.</div>';
    }

    if (top.length) {
        html += `<div class="ca-check__title">자주 나온 키워드</div><div class="ca-chips">${top.map(item => `<span class="ca-chip ca-chip--accent">${escapeHtml(item.asset.card)} · ${item.count}</span>`).join('')}</div>`;
    }
    if (unused.length && total > 0) {
        html += `<div class="ca-check__title">한 번도 안 나온 키워드</div><div class="ca-chips">${unused.slice(0, 30).map(asset => `<span class="ca-chip ca-chip--muted">${escapeHtml(asset.card)}</span>`).join('')}${unused.length > 30 ? `<span class="ca-chip ca-chip--muted">+${unused.length - 30}</span>` : ''}</div>`;
    }
    $result.html(html);
}

async function cleanupSettings() {
    const all = settings().characterAssets;
    const ids = new Set(characters.map(getCharId).filter(Boolean));
    const orphans = ids.size ? Object.keys(all).filter(key => !ids.has(key)) : [];

    let staleRefs = 0;
    for (const owner of store.owners.values()) {
        const names = new Set(owner.assets.map(asset => asset.fileName));
        const data = getCharData(owner.id);
        staleRefs += data.disabledAssets.filter(name => !names.has(name)).length;
        staleRefs += Object.keys(data.aliases).filter(name => !names.has(name)).length;
    }

    if (orphans.length === 0 && staleRefs === 0) {
        showToast('info', '정리할 설정이 없어요. 깔끔해요!');
        return;
    }
    const ok = await askConfirm(
        `<h3><i class="fa-solid fa-wand-sparkles"></i> 남은 설정 정리</h3>
         <p>지워진 캐릭터 설정 ${orphans.length}개, 없는 파일 기록 ${staleRefs}개를 정리할까요?<br>이미지 파일은 건드리지 않아요.</p>`,
        { okButton: '정리' },
    );
    if (!ok) return;
    orphans.forEach(key => delete all[key]);
    for (const owner of store.owners.values()) {
        const names = new Set(owner.assets.map(asset => asset.fileName));
        const data = getCharData(owner.id);
        data.disabledAssets = data.disabledAssets.filter(name => names.has(name));
        Object.keys(data.aliases).forEach(name => { if (!names.has(name)) delete data.aliases[name]; });
    }
    saveSettingsDebounced();
    showToast('success', '설정을 정리했어요.');
    afterLocalChange();
}

async function resetCurrentCharacterSettings() {
    const id = getCurrentCharId();
    if (!id) {
        showToast('info', '캐릭터를 먼저 선택해 주세요.');
        return;
    }
    const ok = await askConfirm(
        `<h3><i class="fa-solid fa-eraser"></i> 이 캐릭터 설정 초기화</h3>
         <p><b>${escapeHtml(getOwnerName(id))}</b>의 꺼짐·별칭·에셋 링크·버전 목록을 처음 상태로 돌려요.<br>이미지 파일은 지우지 않아요.</p>`,
        { okButton: '초기화' },
    );
    if (!ok) return;
    settings().characterAssets[id] = defaultCharacterData();
    saveSettingsDebounced();
    populateAssetLinkSelect();
    populateAssetPresetSelect();
    await reloadAll();
    showToast('success', '초기화했어요.');
}

function buildAccentSwatches() {
    $('#ca_accent_swatches').html(ACCENTS.map(accent => `
        <button type="button" class="ca-swatch" role="radio" aria-checked="false" data-accent="${accent.id}">
            <span class="ca-swatch__dot" style="--swatch:${accent.color}" aria-hidden="true"></span>${escapeHtml(accent.name)}
        </button>`).join(''));
}

function syncAccentSwatches() {
    const current = getUiSettings().accent;
    $('#ca_accent_swatches .ca-swatch').each(function () {
        const on = this.dataset.accent === current;
        this.setAttribute('aria-checked', on ? 'true' : 'false');
        this.tabIndex = on ? 0 : -1;
    });
}

function buildRegexStyleGrid() {
    const sample = previewSampleAsset();
    $('#ca_regex_style_grid').html(RENDER_STYLES.map(style => `<div class="ca-regex-tile">
            ${styleTileHtml(style, sample, { asRadio: false })}
            <b>${escapeHtml(style.name)}</b>
            <small>${escapeHtml(style.desc)}</small>
            <button type="button" class="ca-chip-btn" data-download-style="${style.id}"><i class="fa-solid fa-download" aria-hidden="true"></i>받기</button>
        </div>`).join(''));
}

function buildMacroUi() {
    $('#ca_macro_chips').html(MACRO_DOCS.filter(doc => doc.chip).map(doc => `<button type="button" class="ca-macro-chip" data-macro="${escapeHtml(doc.macro)}" title="${escapeHtml(doc.desc)}">${escapeHtml(doc.macro)}</button>`).join(''));
    $('#ca_macro_table').html(`<dl class="ca-macro-table">${MACRO_DOCS.map(doc => `<dt><code>${escapeHtml(doc.macro)}</code></dt><dd>${escapeHtml(doc.desc)}</dd>`).join('')}</dl>`);
}

/* ----- 설정 백업 / 복원 ----- */

function exportExtensionSettings() {
    try {
        const payload = {
            type: 'character-assets-settings',
            version: 2,
            extensionVersion: VERSION,
            exportedAt: new Date().toISOString(),
            settings: settings(),
        };
        download(JSON.stringify(payload, null, 2), `character-assets-settings_${new Date().toISOString().replace(/[:.]/g, '-')}.json`, 'application/json');
        showToast('success', '확장 설정을 백업했어요.');
    } catch (error) {
        console.error(`[${MODULE_NAME}] Error exporting settings:`, error);
        showToast('error', '설정을 백업하는 중 오류가 났어요.');
    }
}

async function importExtensionSettings(file) {
    try {
        const payload = JSON.parse(await getFileText(file));
        if (payload?.type !== 'character-assets-settings' || !payload.settings || typeof payload.settings !== 'object') {
            showToast('error', '이 확장의 설정 백업 파일이 아니에요.');
            return;
        }
        const ok = await askConfirm('<h3><i class="fa-solid fa-file-import"></i> 설정 복원</h3><p>지금 설정(프리셋, 캐릭터별 설정, 표시 옵션)이 백업 내용으로 바뀌어요. 계속할까요?</p>', { okButton: '복원' });
        if (!ok) return;
        extension_settings[MODULE_NAME] = payload.settings;
        initializeSettings();
        saveSettingsDebounced();
        syncAllControls();
        applyAppearance();
        setupBuiltinRenderer();
        await onContextChanged();
        showToast('success', '설정을 복원했어요.');
    } catch (error) {
        console.error(`[${MODULE_NAME}] Error importing settings:`, error);
        showToast('error', `설정을 복원하지 못했어요: ${describeError(error)}`);
    }
}

/* ----- Regex 스타일 다운로드 ----- */

function regexDataFor(template) {
    return {
        id: uuidv4(),
        scriptName: `character-assets-${template.id}`,
        findRegex: template.find,
        replaceString: template.replace,
        trimStrings: [],
        placement: [2],
        disabled: false,
        markdownOnly: true,
        promptOnly: false,
        runOnEdit: false,
        substituteRegex: 0,
        minDepth: null,
        maxDepth: null,
    };
}

function downloadImageStyleRegex(styleId) {
    const template = getRegexTemplate(styleId);
    if (!template) {
        showToast('error', '스타일을 찾지 못했어요.');
        return;
    }
    download(JSON.stringify(regexDataFor(template), null, 4), `character-assets-regex-${styleId}.json`, 'application/json');
    showToast('success', `"${template.name}" 정규식을 받았어요.`);
}

function downloadAllImageStyleRegex() {
    const templates = RENDER_STYLES.map(style => getRegexTemplate(style.id));
    download(JSON.stringify(templates.map(regexDataFor), null, 4), 'character-assets-regex-all-styles.json', 'application/json');
    showToast('success', '모든 스타일 정규식을 받았어요.');
}

/* =========================================================
   탭 / 라디오 그룹 공용
   ========================================================= */

function selectTab(name, { focus = false, save = true } = {}) {
    const tabs = document.querySelectorAll('#character_assets_settings .ca-tab');
    let found = false;
    tabs.forEach(tab => {
        const on = tab.dataset.tab === name;
        if (on) found = true;
        tab.setAttribute('aria-selected', on ? 'true' : 'false');
        tab.tabIndex = on ? 0 : -1;
        if (on && focus) tab.focus();
    });
    if (!found) return;
    document.querySelectorAll('#character_assets_settings .ca-panel').forEach(panel => {
        const on = panel.dataset.panel === name;
        panel.hidden = !on;
        panel.classList.toggle('is-active', on);
    });
    if (save && getUiSettings().tab !== name) {
        getUiSettings().tab = name;
        saveSettingsDebounced();
    }
    if (name === 'render') renderPreview();
    if (name === 'prompt') updatePromptStats();
    if (name === 'tools') buildRegexStyleGrid();
}

/** 방향키로 움직이는 라디오/탭 묶음 */
function bindArrowKeys(container, itemSelector, onActivate) {
    $(container).on('keydown', itemSelector, function (event) {
        const items = $(container).find(itemSelector).filter(':visible').toArray();
        const index = items.indexOf(this);
        let next = -1;
        if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = (index + 1) % items.length;
        else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = (index - 1 + items.length) % items.length;
        else if (event.key === 'Home') next = 0;
        else if (event.key === 'End') next = items.length - 1;
        if (next < 0) return;
        event.preventDefault();
        items[next].focus();
        onActivate(items[next]);
    });
}

function syncFilterSeg() {
    const filter = getUiSettings().filter;
    $('#ca_filter_seg [data-filter]').each(function () {
        const on = this.dataset.filter === filter;
        this.setAttribute('aria-checked', on ? 'true' : 'false');
        this.tabIndex = on ? 0 : -1;
    });
}

function syncViewToggle() {
    const list = getUiSettings().view === 'list';
    $('#ca_view_toggle')
        .attr('aria-pressed', list ? 'true' : 'false')
        .attr('aria-label', list ? '카드형으로 보기' : '목록형으로 보기')
        .find('i').attr('class', `fa-solid ${list ? 'fa-table-cells-large' : 'fa-list'}`);
}

function syncAllControls() {
    $('#character_assets_image_prompt').val(getImagePromptText());
    updatePresetUI();
    updatePromptDirty();
    updatePromptStats();
    syncRenderControls();
    syncInjectControls();
    syncAccentSwatches();
    syncFilterSeg();
    syncViewToggle();
    $('#ca_sort_select').val(getUiSettings().sort);
    $('#character_assets_webp_convert').prop('checked', Boolean(settings().convertToWebp));
    $('#character_assets_confirm_overwrite').prop('checked', settings().confirmOverwrite !== false);
    selectTab(getUiSettings().tab, { save: false });
}

/* =========================================================
   드래그 앤 드롭 / 붙여넣기
   ========================================================= */

function setupDropZone(element, getTarget) {
    if (!element) return;
    let depth = 0;
    const hasFiles = (event) => Array.from(event.dataTransfer?.types || []).includes('Files');
    element.addEventListener('dragenter', (event) => {
        if (!hasFiles(event)) return;
        event.preventDefault();
        event.stopPropagation();
        depth++;
        element.classList.add('is-dragover');
    });
    element.addEventListener('dragover', (event) => {
        if (!hasFiles(event)) return;
        event.preventDefault();
        event.stopPropagation();
        event.dataTransfer.dropEffect = 'copy';
    });
    element.addEventListener('dragleave', (event) => {
        if (!hasFiles(event)) return;
        event.stopPropagation();
        depth = Math.max(0, depth - 1);
        if (depth === 0) element.classList.remove('is-dragover');
    });
    element.addEventListener('drop', async (event) => {
        if (!hasFiles(event)) return;
        event.preventDefault();
        event.stopPropagation();
        depth = 0;
        element.classList.remove('is-dragover');
        const files = Array.from(event.dataTransfer.files || []);
        if (files.length === 0) return;
        const target = await getTarget(element);
        if (target) await handleDroppedFiles(files, target);
    });
}

function setupPaste(element, getTarget) {
    if (!element) return;
    element.addEventListener('paste', async (event) => {
        const files = Array.from(event.clipboardData?.files || []).filter(isImageFile);
        if (files.length === 0) return;
        event.preventDefault();
        event.stopPropagation();
        const target = await getTarget(element);
        if (target) await handlePastedImages(files, target);
    });
}

/* =========================================================
   이벤트 연결
   ========================================================= */

let pendingUploadTarget = null;

function setupEventHandlers() {
    const $root = $('#character_assets_settings');

    // ----- 탭 -----
    $root.on('click', '.ca-tab', function () {
        selectTab(this.dataset.tab);
    });
    bindArrowKeys($root.find('.ca-tabs'), '.ca-tab', (tab) => selectTab(tab.dataset.tab));

    // ----- 요약 -----
    $('#ca_refresh_btn').on('click', async function () {
        $(this).find('i').addClass('fa-spin');
        await reloadAll();
        $(this).find('i').removeClass('fa-spin');
        showToast('success', '에셋 목록을 새로 불러왔어요.');
    });
    $('#ca_open_gallery_btn').on('click', () => openGallery());

    // ----- 시작하기 -----
    $('#ca_setup_hide').on('click', () => {
        getUiSettings().setupHidden = true;
        saveSettingsDebounced();
        renderSetup();
    });
    $('#ca_setup').on('click', '[data-setup-action]', function () {
        const action = this.dataset.setupAction;
        if (action === 'assets') {
            selectTab('assets');
            document.getElementById('ca_dropzone')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        } else if (action === 'render') {
            getRendererSettings().enabled = true;
            saveSettingsDebounced();
            syncRenderControls();
            setupBuiltinRenderer();
            renderSetup();
            showToast('success', '내장 렌더러를 켰어요.');
        } else if (action === 'prompt') {
            getInjectSettings().enabled = true;
            saveSettingsDebounced();
            syncInjectControls();
            updatePromptInjection();
            renderAll();
            showToast('success', '프롬프트 자동 삽입을 켰어요.');
        } else if (action === 'prompt-manual') {
            getUiSettings().promptLinked = true;
            saveSettingsDebounced();
            renderSetup();
        }
    });

    // ----- 에셋 폴더 -----
    $('#asset_link_select').on('change', function () { onAssetLinkChanged(String($(this).val() || '')); });
    $('#asset_link_clear_btn').on('click', () => {
        $('#asset_link_select').val('');
        onAssetLinkChanged('');
    });
    $('#asset_preset_select').on('change', async function () {
        const id = getCurrentCharId();
        if (!id) return;
        const value = String($(this).val() || '');
        getCharData(id).activeAssetPreset = value;
        saveSettingsDebounced();
        updateAssetPresetInfo(value);
        await reloadAll();
    });
    $('#asset_preset_add_btn').on('click', addAssetVersion);
    $('#asset_preset_rename_btn').on('click', renameAssetVersion);
    $('#asset_preset_delete_btn').on('click', deleteAssetVersion);

    // ----- 업로드 -----
    const startPicker = async (anchor, inputId) => {
        if ($(anchor).hasClass('disabled')) {
            showToast('info', '에셋 링크를 쓰는 중에는 올릴 수 없어요.');
            return;
        }
        const target = await pickUploadTarget(anchor);
        if (!target) return;
        pendingUploadTarget = target;
        document.getElementById(inputId)?.click();
    };
    $('#character_assets_upload_image_btn').on('click', function () { startPicker(this, 'character_assets_upload_image'); });
    $('#character_assets_upload_zip_btn').on('click', function () { startPicker(this, 'character_assets_upload_zip'); });
    $('#ca_upload_url_btn').on('click', function () {
        if ($(this).hasClass('disabled')) return;
        openUrlUploadDialog(this);
    });
    $('#ca_dropzone .ca-drop__hint').on('click', function () { startPicker(document.getElementById('character_assets_upload_image_btn'), 'character_assets_upload_image'); });

    $('#character_assets_upload_image').on('change', async function () {
        const files = Array.from(this.files || []);
        $(this).val('');
        const target = pendingUploadTarget;
        pendingUploadTarget = null;
        if (files.length && target) await uploadImageFiles(files, target);
    });
    $('#character_assets_upload_zip').on('change', async function () {
        const file = this.files?.[0];
        $(this).val('');
        const target = pendingUploadTarget;
        pendingUploadTarget = null;
        if (file && target) await uploadZipFile(file, target);
    });
    $('#ca_upload_cancel_btn').on('click', function () {
        job.cancelled = true;
        $(this).prop('disabled', true);
        $('#ca_upload_progress_label').text('남은 작업을 멈추는 중…');
    });

    $('#character_assets_webp_convert').on('change', function () {
        settings().convertToWebp = $(this).prop('checked');
        saveSettingsDebounced();
    });
    $('#character_assets_confirm_overwrite').on('change', function () {
        settings().confirmOverwrite = $(this).prop('checked');
        saveSettingsDebounced();
    });

    const panelTarget = (element) => pickUploadTarget(element);
    setupDropZone(document.getElementById('ca_dropzone'), panelTarget);
    setupDropZone(document.getElementById('character_assets_list'), panelTarget);
    setupPaste(document.getElementById('character_assets_settings'), () => pickUploadTarget(document.getElementById('character_assets_upload_image_btn')));

    // ----- 목록 도구 -----
    const applySearch = debounce(() => renderAssetList(), 120);
    $('#keyword_filter').on('input', function () {
        listState.query = String($(this).val() || '');
        $('#clear_keyword_filter').prop('hidden', !listState.query);
        applySearch();
    });
    $('#clear_keyword_filter').on('click', function () {
        listState.query = '';
        $('#keyword_filter').val('').trigger('focus');
        $(this).prop('hidden', true);
        renderAssetList();
    });
    const setFilter = (value) => {
        getUiSettings().filter = value;
        saveSettingsDebounced();
        syncFilterSeg();
        renderAssetList();
    };
    $('#ca_filter_seg').on('click', '[data-filter]', function () { setFilter(this.dataset.filter); });
    bindArrowKeys($('#ca_filter_seg'), '[data-filter]', (item) => setFilter(item.dataset.filter));

    $('#ca_sort_select').on('change', function () {
        getUiSettings().sort = String($(this).val());
        saveSettingsDebounced();
        renderAssetList();
    });
    $('#ca_view_toggle').on('click', () => {
        const ui = getUiSettings();
        ui.view = ui.view === 'list' ? 'grid' : 'list';
        saveSettingsDebounced();
        syncViewToggle();
        renderAssetList();
    });
    $('#ca_select_toggle').on('click', () => setSelectMode(!listState.selectMode));
    $('#ca_assets_more_btn').on('click', function () { openAssetsMoreMenu(this); });

    $('#select_all_keywords').on('change', function () {
        const on = $(this).prop('checked');
        listState.visibleKeys.forEach(key => (on ? listState.selected.add(key) : listState.selected.delete(key)));
        renderAssetList();
    });
    $('#ca_bulkbar').on('click', '[data-bulk]', function () {
        const assets = selectedAssets();
        if (assets.length === 0) return;
        const action = this.dataset.bulk;
        if (action === 'on') setAssetsDisabled(assets, false);
        else if (action === 'off') setAssetsDisabled(assets, true);
        else if (action === 'delete') confirmDeleteAssets(assets);
    });

    // ----- 목록 (이벤트 위임) -----
    const list = document.getElementById('character_assets_list');
    list.addEventListener('click', (event) => {
        const target = event.target instanceof Element ? event.target : null;
        if (!target) return;
        const actionEl = target.closest('[data-action]');
        const action = actionEl?.dataset.action;

        if (action === 'member') {
            const owner = actionEl.closest('[data-owner]')?.dataset.owner;
            if (owner) {
                listState.collapsedMembers.has(owner) ? listState.collapsedMembers.delete(owner) : listState.collapsedMembers.add(owner);
                renderAssetList();
            }
            return;
        }
        if (action === 'expand') {
            listState.expandedCards.add(actionEl.dataset.card);
            renderAssetList();
            return;
        }

        const cardEl = target.closest('.ca-asset-card');
        if (listState.selectMode && cardEl && !target.closest('[data-action="toggle"], [data-action="menu"]')) {
            if (target.closest('.ca-asset-card__check')) return; // 체크박스 change에서 처리
            event.preventDefault();
            toggleCardSelection(cardEl.dataset.card);
            return;
        }

        const key = actionEl?.dataset.key || target.closest('[data-key]')?.dataset.key;
        const asset = key ? store.byKey.get(key) : null;
        if (!asset) return;
        if (action === 'preview') openLightboxForAsset(asset);
        else if (action === 'toggle') toggleAsset(asset);
        else if (action === 'menu') openFileMenu(asset, actionEl);
    });
    list.addEventListener('change', (event) => {
        const input = event.target;
        if (input instanceof HTMLInputElement && input.classList.contains('keyword-checkbox')) {
            toggleCardSelection(input.dataset.card, input.checked);
        }
    });
    list.addEventListener('error', (event) => {
        const img = event.target;
        if (img instanceof HTMLImageElement) img.style.visibility = 'hidden';
    }, true);

    // ----- 표시 탭 -----
    $('#character_assets_builtin_renderer_enabled').on('change', function () {
        getRendererSettings().enabled = $(this).prop('checked');
        saveSettingsDebounced();
        setupBuiltinRenderer();
        renderSetup();
        updateRegexConflict();
        showToast(isBuiltinRendererEnabled() ? 'success' : 'info', isBuiltinRendererEnabled() ? '내장 렌더러를 켰어요.' : '내장 렌더러를 껐어요.');
    });
    const setStyle = (style) => {
        getRendererSettings().style = style;
        saveSettingsDebounced();
        syncStyleGrid();
        renderPreview();
        refreshChatAssetsDebounced();
    };
    $('#ca_style_grid').on('click', '.ca-style-tile', function () { setStyle(this.dataset.style); });
    bindArrowKeys($('#ca_style_grid'), '.ca-style-tile', (tile) => setStyle(tile.dataset.style));

    $('#ca_size_range').on('input', function () {
        const value = clamp(Number($(this).val()) || 400, 120, 800);
        getRendererSettings().maxWidth = value;
        $('#ca_size_value').text(`${value}px`);
        saveSettingsDebounced();
        renderPreview();
        refreshChatAssetsDebounced();
    });

    const bindRenderToggle = (selector, key, after) => {
        $(selector).on('change', function () {
            getRendererSettings()[key] = $(this).prop('checked');
            saveSettingsDebounced();
            after?.();
            renderPreview();
            refreshChatAssetsDebounced();
        });
    };
    bindRenderToggle('#ca_render_zoom', 'clickToZoom');
    bindRenderToggle('#ca_render_caption', 'caption');
    bindRenderToggle('#ca_render_smart', 'smartMatch', () => rebuildRendererIndex());
    bindRenderToggle('#character_assets_random_asset', 'randomAsset', () => {
        rebuildKeywords();
        rebuildRendererIndex();
        updatePromptInjection();
    });
    bindRenderToggle('#character_assets_renderer_lazy', 'lazy', () => setupBuiltinRenderer());
    $('#ca_render_missing').on('change', function () {
        getRendererSettings().missing = String($(this).val());
        saveSettingsDebounced();
        // 'raw'로 바꾸면 이미 바뀐 안내도 원래 태그로 되돌린다
        document.querySelectorAll('#chat .mes_text .ca-asset-missing').forEach(el => {
            el.replaceWith(document.createTextNode(`{{img::${el.getAttribute('data-ca-tag') || ''}}}`));
        });
        scheduleRendererPass();
    });

    // ----- 프롬프트 탭 -----
    $('#ca_inject_enabled').on('change', function () {
        getInjectSettings().enabled = $(this).prop('checked');
        saveSettingsDebounced();
        syncInjectControls();
        updatePromptInjection();
        renderHero();
        renderSetup();
    });
    $('#ca_inject_position').on('change', function () {
        getInjectSettings().position = Number($(this).val());
        saveSettingsDebounced();
        syncInjectControls();
        updatePromptInjection();
    });
    $('#ca_inject_depth').on('input', function () {
        getInjectSettings().depth = clamp(parseInt(String($(this).val()), 10) || 0, 0, 999);
        saveSettingsDebounced();
        updatePromptInjection();
    });
    $('#ca_inject_role').on('change', function () {
        getInjectSettings().role = Number($(this).val());
        saveSettingsDebounced();
        updatePromptInjection();
    });

    const syncPromptFromEditor = debounce(() => updatePromptInjection(), 300);
    $('#character_assets_image_prompt').on('input', function () {
        settings().imagePrompt = String($(this).val() ?? '');
        saveSettingsDebounced();
        updatePromptDirty();
        updatePromptStats();
        syncPromptFromEditor();
    });
    $('#prompt_preset_selector').on('change', function () {
        const id = String($(this).val() || '');
        if (id) onPresetSelected(id);
    });
    $('#save_preset_btn').on('click', () => saveCurrentPromptToPreset());
    $('#ca_prompt_revert_btn').on('click', function () {
        if ($(this).hasClass('disabled')) return;
        const preset = getCurrentPreset();
        if (preset) setPromptText(preset.prompt);
    });
    $('#ca_prompt_preview_btn').on('click', previewPrompt);
    $('#new_preset_btn').on('click', createPreset);
    $('#rename_preset_btn').on('click', renameCurrentPreset);
    $('#delete_preset_btn').on('click', deleteCurrentPreset);
    $('#ca_prompt_more_btn').on('click', function () { openPromptMoreMenu(this); });
    $('#import_presets_input').on('change', function () {
        const file = this.files?.[0];
        $(this).val('');
        if (file) importPresets(file);
    });
    $('#ca_macro_chips').on('click', '[data-macro]', function () {
        insertAtCursor(document.getElementById('character_assets_image_prompt'), this.dataset.macro);
    });

    // ----- 도구 탭 -----
    $('#ca_chat_check_btn').on('click', runChatCheck);
    $('#ca_chat_check_result').on('click', '[data-check-alias]', function () {
        const asset = store.byKey.get(this.dataset.key);
        if (!asset) return;
        addAlias(asset, this.dataset.checkAlias);
        showToast('success', `'${this.dataset.checkAlias}' → ${asset.fileName} 로 연결했어요.`);
        runChatCheck();
    });

    $('#persona_assets_upload_btn').on('click', async () => {
        const target = await personaTarget();
        if (!target) return;
        pendingUploadTarget = target;
        document.getElementById('persona_assets_upload')?.click();
    });
    $('#persona_assets_upload_zip_btn').on('click', async () => {
        const target = await personaTarget();
        if (!target) return;
        pendingUploadTarget = target;
        document.getElementById('persona_assets_upload_zip')?.click();
    });
    $('#persona_assets_upload').on('change', async function () {
        const files = Array.from(this.files || []);
        $(this).val('');
        const target = pendingUploadTarget;
        pendingUploadTarget = null;
        if (files.length && target) await uploadImageFiles(files, target);
    });
    $('#persona_assets_upload_zip').on('change', async function () {
        const file = this.files?.[0];
        $(this).val('');
        const target = pendingUploadTarget;
        pendingUploadTarget = null;
        if (file && target) await uploadZipFile(file, target);
    });
    $('#persona_assets_gallery_btn').on('click', function () {
        if ($(this).hasClass('disabled')) return;
        openGallery(PERSONA_OWNER);
    });

    $('#export_assets_zip_btn').on('click', () => exportAssetsAsZip());
    $('#smart_rename_btn').on('click', function () {
        if ($(this).hasClass('disabled')) {
            showToast('info', '에셋 링크를 쓰는 중에는 정돈할 수 없어요.');
            return;
        }
        openSmartRenamePopup();
    });
    $('#export_settings_btn').on('click', exportExtensionSettings);
    $('#import_settings_btn').on('click', () => $('#import_settings_input').trigger('click'));
    $('#import_settings_input').on('change', async function () {
        const file = this.files?.[0];
        $(this).val('');
        if (file) await importExtensionSettings(file);
    });
    $('#ca_cleanup_btn').on('click', cleanupSettings);
    $('#ca_reset_char_btn').on('click', resetCurrentCharacterSettings);

    const setAccent = (accent) => {
        getUiSettings().accent = accent;
        saveSettingsDebounced();
        syncAccentSwatches();
        applyAppearance();
        buildStyleGrid();
        renderPreview();
        refreshChatAssetsDebounced();
    };
    $('#ca_accent_swatches').on('click', '.ca-swatch', function () { setAccent(this.dataset.accent); });
    bindArrowKeys($('#ca_accent_swatches'), '.ca-swatch', (item) => setAccent(item.dataset.accent));

    $('#ca_regex_style_grid').on('click', '[data-download-style]', function () { downloadImageStyleRegex(this.dataset.downloadStyle); });
    $('#download_all_styles_btn').on('click', downloadAllImageStyleRegex);

    setupGalleryHandlers();
}

function setupGalleryHandlers() {
    const dialog = document.getElementById('asset_gallery_modal');
    const container = document.getElementById('asset_gallery_container');
    if (!dialog || !container) return;
    shieldFromDrawerClose(dialog);

    $('#ca_gallery_close').on('click', closeGalleryModal);
    dialog.addEventListener('cancel', (event) => {
        event.preventDefault();
        closeGalleryModal();
    });
    dialog.addEventListener('click', (event) => {
        if (event.target === dialog) closeGalleryModal();
    });

    const applyGallerySearch = debounce(renderGallery, 120);
    $('#gallery_search').on('input', applyGallerySearch);
    $('#ca_gallery_source').on('change', function () {
        galleryState.source = String($(this).val());
        galleryState.selected.clear();
        renderGallery();
    });
    $('#gallery_grid_size').on('click', '[data-size]', function () { applyGridSize(this.dataset.size); });
    bindArrowKeys($('#gallery_grid_size'), '[data-size]', (item) => applyGridSize(item.dataset.size));
    $('#gallery_select_mode_btn').on('click', () => setGallerySelectMode(!galleryState.selectMode));
    $('#ca_gallery_select_all').on('click', () => {
        const allSelected = galleryState.items.every(item => galleryState.selected.has(item.key));
        galleryState.items.forEach(item => (allSelected ? galleryState.selected.delete(item.key) : galleryState.selected.add(item.key)));
        renderGallery();
    });
    $('#ca_gallery_off_selected').on('click', () => {
        const assets = Array.from(galleryState.selected).map(key => store.byKey.get(key)).filter(Boolean);
        const turnOff = assets.some(asset => !asset.disabled);
        setAssetsDisabled(assets, turnOff);
    });
    $('#gallery_delete_selected_btn').on('click', () => {
        const assets = Array.from(galleryState.selected).map(key => store.byKey.get(key)).filter(Boolean);
        confirmDeleteAssets(assets);
    });

    container.addEventListener('click', (event) => {
        const target = event.target instanceof Element ? event.target : null;
        const itemEl = target?.closest('.ca-gitem');
        if (!itemEl) return;
        const asset = store.byKey.get(itemEl.dataset.key);
        if (!asset) return;
        const actionEl = target.closest('[data-action]');
        const action = actionEl?.dataset.action;

        if (galleryState.selectMode) {
            galleryState.selected.has(asset.key) ? galleryState.selected.delete(asset.key) : galleryState.selected.add(asset.key);
            itemEl.classList.toggle('is-selected', galleryState.selected.has(asset.key));
            itemEl.querySelector('.ca-thumb-btn')?.setAttribute('aria-pressed', galleryState.selected.has(asset.key) ? 'true' : 'false');
            updateGallerySelectbar();
            return;
        }
        if (action === 'open') openLightbox(galleryState.items, Number(itemEl.dataset.index) || 0);
        else if (action === 'insert') { insertTagIntoChat(asset); closeGalleryModal(); }
        else if (action === 'copy') copyTag(asset);
        else if (action === 'toggle') toggleAsset(asset);
        else if (action === 'menu') openFileMenu(asset, actionEl);
    });
    container.addEventListener('error', (event) => {
        const img = event.target;
        if (img instanceof HTMLImageElement) img.style.visibility = 'hidden';
    }, true);

    const target = () => {
        const value = galleryTarget();
        if (!value) showToast('info', galleryState.source === 'all' ? '멤버를 하나 고른 뒤 올려 주세요.' : '이 에셋 폴더에는 올릴 수 없어요.');
        return Promise.resolve(value);
    };
    setupDropZone(container, target);
    setupPaste(dialog, target);
}

/* =========================================================
   매크로
   ========================================================= */

const macroState = { legacyParser: null, legacyArgKeys: new Set() };

function currentCharKey() {
    const id = getCurrentCharId();
    return id ? getEffectiveCharacterName(id) : '';
}

const MACRO_DEFS = [
    { name: 'img_inprompt', description: '캐릭터 에셋 이미지 지침 전체', fn: () => getImagePromptText(), nested: true },
    { name: 'img_keywords', description: '켜진 캐릭터 에셋 키워드 목록', fn: () => activeLabelList },
    { name: 'img_keywords_autogen', description: '자동 갱신되는 캐릭터 에셋 파일명 목록', fn: () => autoGeneratedKeywords },
    { name: 'img_keywords_grouped', description: '묶음으로 정리한 에셋 키워드 목록', fn: () => autoGeneratedKeywordsGrouped || autoGeneratedKeywords },
    { name: 'charkey', description: '현재 캐릭터의 실제 에셋 폴더 경로 (링크/버전 반영)', fn: () => currentCharKey() },
    { name: 'img_count', description: '현재 켜진 캐릭터 에셋 수', fn: () => String(activeAssetCount) },
];

const MACRO_ARG_DEFS = [
    { name: 'img_rand', arg: 'prefix', description: '키워드로 시작하는 에셋 중 무작위 하나의 주소', fn: (value) => randomAssetUrl(value) },
    { name: 'img_resolve', arg: 'name', description: '이름에 맞는 에셋 주소', fn: (value) => resolveAsset(value, { stable: true })?.path || '' },
];

async function registerMacros() {
    const [system, legacy, power] = await Promise.all([
        loadModule('../../../macros/macro-system.js'),
        loadModule('../../../macros.js'),
        loadModule('../../../power-user.js'),
    ]);
    const registry = system?.macros?.registry;
    const newEngineOn = Boolean(registry) && power?.power_user?.experimental_macro_engine !== false;

    if (registry?.registerMacro) {
        MACRO_DEFS.forEach(def => registry.registerMacro(def.name, {
            category: 'character',
            description: def.description,
            handler: (ctx) => {
                const value = def.fn();
                return def.nested && typeof ctx?.resolve === 'function' ? ctx.resolve(value) : value;
            },
        }));
        MACRO_ARG_DEFS.forEach(def => registry.registerMacro(def.name, {
            category: 'character',
            description: def.description,
            unnamedArgs: [{ name: def.arg, description: def.arg === 'prefix' ? '키워드 앞부분' : '에셋 이름' }],
            handler: ({ unnamedArgs }) => def.fn(unnamedArgs?.[0] ?? ''),
        }));
    }

    // 구형 매크로 엔진: 인자를 못 받으므로 {{img_rand::키워드}}를 키워드마다 따로 등록한다
    const parser = legacy?.MacrosParser;
    if (parser?.registerMacro && !newEngineOn) {
        MACRO_DEFS.forEach(def => parser.registerMacro(def.name, () => def.fn(), def.description));
        macroState.legacyParser = parser;
        syncLegacyArgMacros();
    }
}

function syncLegacyArgMacros() {
    const parser = macroState.legacyParser;
    if (!parser) return;
    macroState.legacyArgKeys.forEach(key => {
        try { parser.unregisterMacro(key); } catch { /* 무시 */ }
    });
    macroState.legacyArgKeys.clear();
    const keys = new Set();
    getActiveAssets().slice(0, 400).forEach(asset => {
        keys.add(`img_rand::${asset.group}`);
        keys.add(`img_resolve::${asset.fileName}`);
        keys.add(`img_resolve::${asset.base}`);
    });
    keys.forEach(key => {
        const [name, value] = key.split('::');
        const def = MACRO_ARG_DEFS.find(item => item.name === name);
        try {
            parser.registerMacro(key, () => def.fn(value));
            macroState.legacyArgKeys.add(key);
        } catch { /* 무시 */ }
    });
}

/* =========================================================
   슬래시 명령어 / 마법봉 메뉴
   ========================================================= */

async function uploadAssetCommand(args, url) {
    const target = store.mode === 'single' ? characterTarget(getSingleOwner()) : null;
    if (!url) {
        showToast('error', '올릴 이미지 주소를 적어 주세요.');
        return '';
    }
    if (!target) {
        showToast('error', '캐릭터 하나를 선택한 상태에서 써 주세요.');
        return '';
    }
    if (isAssetLinkActive(target.ownerId)) {
        showToast('info', '에셋 링크를 쓰는 중에는 올릴 수 없어요.');
        return '';
    }
    const label = String(args?.label || '').trim();
    if (!label) {
        showToast('error', 'label=키워드 를 지정해 주세요.');
        return '';
    }
    await uploadFromUrl(target, String(url).trim(), label);
    return '';
}

async function refreshImageKeywordsCommand() {
    await reloadAll();
    const keywordString = autoGeneratedKeywords;
    if (keywordString) {
        showToast('success', `이미지 키워드를 갱신했어요: ${keywordString.substring(0, 100)}${keywordString.length > 100 ? '...' : ''}`);
    } else {
        showToast('info', '이미지 키워드가 비어 있어요.');
    }
    return '';
}

function registerSlashCommands() {
    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'assets-upload',
        aliases: ['업로드에셋'],
        callback: uploadAssetCommand,
        namedArgumentList: [
            SlashCommandNamedArgument.fromProps({
                name: 'label',
                description: '이미지에 붙일 키워드(라벨)',
                typeList: [ARGUMENT_TYPE.STRING],
                isRequired: true,
            }),
        ],
        unnamedArgumentList: [
            SlashCommandArgument.fromProps({
                description: '올릴 이미지 URL',
                typeList: [ARGUMENT_TYPE.STRING],
                isRequired: true,
            }),
        ],
        helpString: '이미지 URL로 현재 캐릭터 에셋을 올립니다.',
    }));

    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'refresh-img-keywords',
        aliases: ['키워드갱신', 'refresh_img_keywords'],
        callback: refreshImageKeywordsCommand,
        helpString: '현재 캐릭터의 이미지 키워드를 다시 불러옵니다.',
    }));

    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'assets-gallery',
        aliases: ['에셋갤러리'],
        callback: () => {
            openGallery();
            return '';
        },
        helpString: '현재 캐릭터의 에셋 갤러리를 엽니다.',
    }));

    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'assets-list',
        aliases: ['에셋목록'],
        callback: () => autoGeneratedKeywords,
        returns: '켜진 에셋 파일명 목록 (쉼표 구분)',
        helpString: '켜진 에셋 파일명 목록을 돌려줍니다. 다른 명령어로 넘겨서 쓸 수 있어요.',
    }));
}

function addWandMenuItem() {
    const menu = document.getElementById('extensionsMenu');
    if (!menu || document.getElementById('ca_wand_gallery')) return;
    const item = document.createElement('div');
    item.id = 'ca_wand_gallery';
    item.className = 'list-group-item flex-container flexGap5';
    item.title = '현재 캐릭터의 에셋을 보고 채팅창에 넣어요.';
    item.innerHTML = '<div class="fa-solid fa-images extensionsMenuExtensionButton"></div><span>에셋 갤러리</span>';
    item.addEventListener('click', () => openGallery());
    menu.appendChild(item);
}

/* =========================================================
   초기화
   ========================================================= */

function collapseCharacterAssetsDrawer() {
    const drawer = $('#character_assets_settings > .inline-drawer');
    drawer.children('.inline-drawer-content').hide();
    drawer.find('> .inline-drawer-header .inline-drawer-icon').removeClass('up fa-circle-chevron-up').addClass('down fa-circle-chevron-down');
}


async function initializeExtension() {
    initializeSettings();

    const html = await $.get(`${EXTENSION_BASE}templates/settings.html`);
    $('#extensions_settings').append(html);
    $('#ca_version_badge').text(`v${VERSION}`);
    // 갤러리는 드로어가 닫혀 있어도 열려야 하므로 body로 옮긴다
    const gallery = document.getElementById('asset_gallery_modal');
    if (gallery) document.body.appendChild(gallery);
    collapseCharacterAssetsDrawer();

    applyAppearance();
    watchThemeChanges();
    injectFrameStyles();

    buildStyleGrid();
    buildAccentSwatches();
    buildRegexStyleGrid();
    buildMacroUi();

    setupEventHandlers();
    syncAllControls();

    registerSlashCommands();
    addWandMenuItem();
    setupChatInteractions();
    setupBuiltinRenderer();

    const scheduleChat = () => scheduleRendererPass();
    eventSource.on(event_types.CHAT_CHANGED, onContextChanged);
    if (event_types.GROUP_UPDATED) eventSource.on(event_types.GROUP_UPDATED, () => { if (isGroupMode()) reloadAll(); });
    if (event_types.PERSONA_CHANGED) eventSource.on(event_types.PERSONA_CHANGED, () => reloadAll());
    if (event_types.GENERATION_STARTED) eventSource.on(event_types.GENERATION_STARTED, updatePromptInjection);
    [
        event_types.MESSAGE_RECEIVED,
        event_types.MESSAGE_UPDATED,
        event_types.MESSAGE_SWIPED,
        event_types.MESSAGE_EDITED,
        event_types.CHARACTER_MESSAGE_RENDERED,
        event_types.USER_MESSAGE_RENDERED,
        event_types.MORE_MESSAGES_LOADED,
    ].filter(Boolean).forEach(type => eventSource.on(type, scheduleChat));

    await registerMacros();
    await onContextChanged();

    console.debug(`[${MODULE_NAME}] v${VERSION} 초기화 완료`);
}

$(document).ready(function () {
    initializeExtension().catch(error => console.error(`[${MODULE_NAME}] 초기화 실패:`, error));
});
