# Character Assets · 캐릭터 에셋 (SillyTavern Extension)

> [!IMPORTANT]
> **This extension is distributed on [kkangtong.xyz](https://kkangtong.xyz).**
> If you share, repost, translate, or introduce it anywhere else, **you must credit the source** — for example: `Source: kkangtong.xyz (https://kkangtong.xyz)`
>
> **이 확장은 [깡통 사이트(kkangtong.xyz)](https://kkangtong.xyz)에서 배포됐습니다.**
> 다른 곳에 소개하거나 옮길 때는 **반드시 출처를 표기해 주세요.** (예: `출처: kkangtong.xyz`)

**[English](#english)** · **[한국어](#한국어)**

---

## English

Character Assets lets the AI show character images in the chat.
You upload images for a character, the AI writes a tag such as `{{img::happy.png}}` where it fits the story, and the extension turns that tag into the picture. No Regex scripts are needed.

> [!NOTE]
> The extension's interface is in Korean. The [UI glossary](#ui-glossary) below maps every label you need to English. The image instructions sent to the AI are in English by default.

### Features

- Per-character image assets: upload images, ZIP files, or URLs; drag and drop; paste with <kbd>Ctrl</kbd>+<kbd>V</kbd>
- Built-in renderer that turns `{{img::...}}` tags into images (no Regex needed)
- 11 frame styles: plain, thin line, photo print, polaroid, masking tape, photo corners, stamp, film strip, floating shadow, float left, float right
- Fuzzy name matching: finds the closest image even when the AI gets the name slightly wrong
- Aliases: give one file several names
- Automatic prompt injection: no need to paste `{{img_inprompt}}` yourself
- Turn assets on/off, multi-select, bulk on/off/delete
- Asset gallery, full-size viewer, insert a tag into the chat box in one tap
- Chat check: lists missing names, most-used keywords, and unused keywords
- Asset links, asset versions, persona assets, group chats
- Works with light, dark, and translucent themes; mobile friendly

### Installation

1. In SillyTavern, open the **Extensions** menu (the stacked-blocks icon at the top).
2. Click **Install extension** and paste:
   ```
   https://github.com/tincansimagine/character-assets
   ```
3. **캐릭터 에셋** (Character Assets) appears in the extensions panel.

**Updating:** Extensions → **Manage extensions** → update button next to Character Assets → reload the page (<kbd>F5</kbd>).
Your images, presets, and per-character settings are kept.

### Quick start

The panel has a **시작하기** (Get started) card with three steps:

1. **Upload images** — open the **에셋** (Assets) tab and drop images or a ZIP. **The file name is the keyword** (e.g. `joy.png`, `angry_1.webp`).
2. **Show images in chat** — press **켜기** (Turn on) to enable the built-in renderer. Pick a frame and size in the **표시** (Display) tab.
3. **Connect the prompt** — press **자동 삽입 켜기** (Turn on auto-insert).
   Alternatively, put `{{img_inprompt}}` in the character description or Author's Note yourself. **Use only one of the two**, or the instructions are sent twice.

When the AI replies with `{{img::joy.png}}`, the image appears in the message.

### File naming

The file name (without extension) is the keyword the AI uses.

| Pattern | Example | Meaning |
|---|---|---|
| `keyword.ext` | `joy.png` | one image |
| `keyword_N.ext` / `keyword-N.ext` | `joy_1.png`, `joy-2.png` | several images for one keyword |
| `keyword.note.ext` | `joy.expressive.png` | variant with a description |

With **랜덤 에셋** (Random asset) on in the Display tab, the AI only sees `joy`, and one of `joy_1`, `joy_2`, … is picked at random.

Supported formats: PNG, WebP, GIF, JPEG. Optional WebP conversion on upload saves space (GIF excluded).

### Fuzzy name matching

With **비슷한 이름 자동 연결** (Fuzzy name matching) on, a tag that does not match exactly is linked to the closest asset:

| AI wrote | Shown file | Why |
|---|---|---|
| `Happy Smile.png` | `happy_smile.webp` | case, spaces, `_` `-` `.` ignored |
| `joy.png` | `joy.webp` | different extension |
| `angry.png` | `angry_1.png` | grouped name |
| `嬉しい`, `기쁨` | `happy.png` | emotion words in English, Korean, Japanese |
| `suprised.png` | `surprised.png` | small typo |
| `smiling` | `smile.png` | an alias you registered |

If a name still does not match, open **도구 → 채팅 점검** (Tools → Chat check) and tap a suggested file to save the name as an alias.

### Macros

| Macro | Returns |
|---|---|
| `{{img_inprompt}}` | the full image instructions (not needed with auto-insert) |
| `{{img_keywords_grouped}}` | grouped keyword list, e.g. `angry_[1, 2], happy` |
| `{{img_keywords_autogen}}` | enabled file names with extensions |
| `{{img_keywords}}` | enabled keywords without extensions |
| `{{img_count}}` | number of enabled assets |
| `{{charkey}}` | the character's actual asset folder (respects links and versions) |
| `{{img_rand::keyword}}` | URL of a random asset whose name starts with the keyword |
| `{{img_resolve::name}}` | URL of the asset that best matches the name |

### Slash commands

| Command | Description |
|---|---|
| `/assets-gallery` | open the asset gallery |
| `/assets-list` | return the list of enabled file names (for STscript) |
| `/assets-upload label=keyword URL` | upload an image from a URL under the given keyword |
| `/refresh-img-keywords` | reload the asset list and keywords |

### UI glossary

| Korean label | English |
|---|---|
| 시작하기 | Get started |
| 에셋 / 표시 / 프롬프트 / 도구 | Assets / Display / Prompt / Tools (the four tabs) |
| 켜기 / 끄기 | Turn on / Turn off |
| 에셋 올리기 · 이미지 · ZIP · URL | Upload assets · Images · ZIP · URL |
| WebP로 바꿔서 용량 줄이기 | Convert to WebP to save space |
| 별칭 | Aliases |
| 이름 바꾸기 · 파일 받기 · 삭제 | Rename · Download · Delete |
| 태그 복사 · 채팅창에 넣기 · 크게 보기 | Copy tag · Insert into chat box · View full size |
| 내장 렌더러로 이미지 표시 | Show images with the built-in renderer |
| 표시 스타일 · 최대 너비 | Frame style · Max width |
| 비슷한 이름 자동 연결 | Fuzzy name matching |
| 랜덤 에셋 | Random asset |
| 눌러서 크게 보기 · 이미지 아래 이름 표시 | Tap to enlarge · Show name under image |
| 못 찾은 태그: 작은 안내 표시 / 숨기기 / 태그 그대로 두기 | Unmatched tags: small notice / hide / keep the raw tag |
| 프롬프트 자동 삽입 · 위치 · 역할 · 깊이 | Auto-insert prompt · Position · Role · Depth |
| 메인 프롬프트 앞 / 뒤 · 채팅 안 (깊이) | Before / after main prompt · In chat (depth) |
| 프리셋 · 저장 · 되돌리기 · 미리보기 | Preset · Save · Revert · Preview |
| 채팅 점검 · 점검하기 | Chat check · Run check |
| 페르소나 에셋 | Persona assets |
| 에셋 폴더 · 에셋 링크 · 에셋 버전 | Asset folder · Asset link · Asset version |
| 이 캐릭터 에셋도 같이 쓰기 | Also use this character's own assets (with an asset link) |
| 백업 & 정리 · 이름 정돈 · 남은 설정 정리 | Backup & cleanup · Tidy names · Clean leftover settings |
| 설정 백업 / 설정 복원 · 에셋 ZIP 받기 | Back up / restore settings · Download assets as ZIP |
| 이 캐릭터 설정 초기화 | Reset this character's settings (files are kept) |
| 화면 · 테마 색 | Appearance · Theme color |
| Regex 스타일 받기 | Download Regex styles |
| 에셋 갤러리 (마법봉 메뉴) | Asset gallery (in the wand menu left of the chat box) |

### Troubleshooting

- **Images appear twice** — the built-in renderer and a Regex script are both converting tags. Keep only one. The Display tab warns you when both are on.
- **Instructions are sent twice** — auto-insert is on and `{{img_inprompt}}` is also in the prompt. Remove one.
- **Upload fails** — the page has usually been open long enough for its security token to expire. Reload and try again. The error notice shows the cause.
- **Linked character's images replace this character's own** — by default an asset link uses the other character's folder *instead of* this one, and uploads are locked. Turn on **이 캐릭터 에셋도 같이 쓰기** (Also use this character's own assets) under **에셋 폴더** (Asset folder) to use both folders together. New uploads then go to this character's folder, and when names clash this character's file wins. Files from the linked character can only be renamed or deleted from that character.
- **Too many tokens** — turn off assets you are not using (eye icon). The files are not deleted.
- Not every model writes tags perfectly. Keep fuzzy name matching on and most near-misses are handled for you.

---

## 한국어

AI가 대화 흐름에 맞춰 `{{img::파일명}}` 태그를 출력하면, 채팅에 캐릭터 이미지를 보여 주는 확장입니다. Regex 없이 바로 동작합니다.

### 주요 기능

- 캐릭터별 이미지 에셋 관리 (이미지 · ZIP · URL, 끌어다 놓기, <kbd>Ctrl</kbd>+<kbd>V</kbd> 붙여넣기)
- 내장 렌더러: `{{img::...}}` 태그를 Regex 없이 이미지로 변환
- 그림 틀 11종: 그대로, 가는 선, 인화 사진, 폴라로이드, 마스킹테이프, 사진 모서리, 우표, 필름, 떠 있는, 글 왼쪽, 글 오른쪽
- 비슷한 이름 자동 연결 (대소문자 · 확장자 · 오타 · 같은 뜻 단어 `기쁨` → `happy`)
- 별칭: 파일 하나에 여러 이름 붙이기
- 프롬프트 자동 삽입: `{{img_inprompt}}`를 직접 넣지 않아도 됨
- 에셋 켜기 · 끄기, 여러 개 선택해서 한 번에 처리
- 갤러리 · 크게 보기 · 채팅창에 태그 넣기
- 채팅 점검 (못 찾은 이름, 자주 쓰인 / 안 쓰인 키워드)
- 에셋 링크 · 에셋 버전 · 페르소나 에셋 · 그룹 채팅 지원
- 밝은 · 어두운 · 반투명 테마 호환, 모바일 대응

### 설치 · 업데이트

**처음 설치**

1. 실리 상단의 **확장(블록 모양)** 메뉴를 엽니다.
2. **Install extension**을 누르고 아래 주소를 넣습니다.
   ```
   https://github.com/tincansimagine/character-assets
   ```
3. 확장 목록에 **캐릭터 에셋**이 보이면 끝입니다.

**업데이트**: 확장 메뉴 → **Manage extensions** → 캐릭터 에셋의 업데이트 버튼 → 페이지 새로고침(<kbd>F5</kbd>).
올려 둔 이미지, 프리셋, 캐릭터별 설정은 그대로 남습니다.

### 시작하기 3단계

패널 위쪽 **시작하기** 카드의 순서와 같습니다.

1. **에셋 올리기** — **에셋** 탭에 이미지나 ZIP을 끌어다 놓습니다. **파일명이 곧 키워드**입니다. (예: `joy.png`, `angry_1.webp`)
2. **채팅에 이미지 표시** — **켜기**를 누르면 내장 렌더러가 켜집니다. 그림 틀과 크기는 **표시** 탭에서 고릅니다.
3. **프롬프트 연결** — **자동 삽입 켜기**를 누릅니다. 캐릭터 설명이나 작가 노트에 `{{img_inprompt}}`를 직접 넣어도 되지만, **둘 중 하나만** 써야 지침이 두 번 들어가지 않습니다.

AI가 `{{img::joy.png}}`로 답하면 그 자리에 이미지가 나옵니다.

### 파일 이름 규칙

| 형식 | 예 | 뜻 |
|---|---|---|
| `키워드.확장자` | `joy.png` | 이미지 하나 |
| `키워드_숫자.확장자` / `키워드-숫자.확장자` | `joy_1.png`, `joy-2.png` | 한 키워드에 여러 장 |
| `키워드.설명.확장자` | `joy.expressive.png` | 설명이 붙은 변형 |

**표시** 탭의 **랜덤 에셋**을 켜면 AI에게는 `joy`만 알려 주고, 표시할 때 `joy_1`, `joy_2` 중 하나를 고릅니다.

지원 형식: PNG, WebP, GIF, JPEG. 올릴 때 WebP로 바꿔 용량을 줄일 수 있습니다. (GIF 제외)

### 비슷한 이름 자동 연결

| AI가 쓴 이름 | 연결되는 파일 | 이유 |
|---|---|---|
| `Happy Smile.png` | `happy_smile.webp` | 대소문자 · 공백 · `_` `-` `.` 무시 |
| `joy.png` | `joy.webp` | 확장자 다름 |
| `angry.png` | `angry_1.png` | 묶음 이름 |
| `기쁨`, `嬉しい` | `happy.png` | 같은 뜻 감정 단어 (한국어 · 영어 · 일본어) |
| `suprised.png` | `surprised.png` | 한두 글자 오타 |
| `미소` | `smile.png` | 등록한 별칭 |

그래도 연결되지 않는 이름은 **도구 → 채팅 점검**에서 후보를 눌러 별칭으로 등록하면 됩니다.

### 매크로

| 매크로 | 내용 |
|---|---|
| `{{img_inprompt}}` | 이미지 지침 전체 (자동 삽입을 쓰면 불필요) |
| `{{img_keywords_grouped}}` | 묶음 키워드 목록 (예: `angry_[1, 2], happy`) |
| `{{img_keywords_autogen}}` | 켜진 파일명 목록 (확장자 포함) |
| `{{img_keywords}}` | 켜진 키워드 목록 (확장자 없이) |
| `{{img_count}}` | 켜진 에셋 개수 |
| `{{charkey}}` | 실제 에셋 폴더 경로 (링크 · 버전 반영) |
| `{{img_rand::키워드}}` | 키워드로 시작하는 에셋 중 하나의 주소 |
| `{{img_resolve::이름}}` | 이름에 맞는 에셋 주소 |

### 슬래시 명령어

| 명령어 | 설명 |
|---|---|
| `/assets-gallery` | 에셋 갤러리 열기 |
| `/assets-list` | 켜진 파일명 목록 반환 (STscript용) |
| `/assets-upload label=키워드 URL` | URL 이미지를 지정한 키워드로 업로드 |
| `/refresh-img-keywords` | 에셋 목록과 키워드 다시 불러오기 |

### 팁

- 채팅 입력창 왼쪽 **마법봉 메뉴 → 에셋 갤러리**에서 이미지를 골라 채팅창에 태그를 바로 넣을 수 있습니다.
- 토큰을 아끼려면 당장 안 쓰는 에셋을 눈 아이콘으로 꺼 두세요. 파일은 지워지지 않습니다.
- 포인트 색은 **도구 → 화면**에서 바꿉니다.
- Regex 방식을 계속 쓰려면 **도구 → Regex 스타일 받기**에서 같은 그림 틀을 받을 수 있습니다.

### 자주 묻는 질문

- **이미지가 두 번씩 나옵니다** — 내장 렌더러와 Regex 변환을 같이 쓰는 경우입니다. 하나만 켜 두세요. 겹치면 표시 탭에 경고가 나옵니다.
- **지침이 두 번 들어갑니다** — 자동 삽입을 켠 채 `{{img_inprompt}}`도 직접 넣은 경우입니다. 하나만 남기세요.
- **업로드가 실패합니다** — 페이지를 오래 켜 둬서 보안 토큰이 만료된 경우가 대부분입니다. 새로고침 후 다시 시도하세요. 실패 원인은 알림에 함께 나옵니다.
- **링크하면 원래 캐릭터 에셋이 안 보입니다 / 업로드가 안 됩니다** — 에셋 링크는 기본적으로 이 캐릭터 폴더 *대신* 링크한 캐릭터 폴더를 씁니다. **에셋 폴더**에서 **이 캐릭터 에셋도 같이 쓰기**를 켜면 두 캐릭터 에셋이 함께 나오고, 새로 올리는 파일은 이 캐릭터 폴더에 들어갑니다. 이름이 겹치면 이 캐릭터 파일이 먼저 나오고, 링크한 캐릭터의 파일은 그 캐릭터에서만 지우거나 이름을 바꿀 수 있습니다.
- **그룹 채팅도 되나요?** — 됩니다. 모든 멤버의 에셋을 함께 불러오고, 올릴 때 대상 멤버를 고릅니다.
- 모든 AI 모델이 태그를 정확히 쓰지는 않습니다. **비슷한 이름 자동 연결**을 켜 두면 대부분 알아서 찾아 줍니다.

---

<p align="center">
<b>Character Assets · 캐릭터 에셋</b> by tincansimagine<br>
Distributed on <a href="https://kkangtong.xyz">kkangtong.xyz</a> — please credit the source when sharing.<br>
깡통 사이트(kkangtong.xyz)에서 배포됐습니다. 다른 곳에 소개할 때는 반드시 출처를 표기해 주세요.
</p>
