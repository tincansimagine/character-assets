// @ts-nocheck
/// <reference types="jquery" />
/// <reference types="toastr" />

// import { $, toastr } from "../../../../script.js"; // 에러 발생으로 주석 처리

import { callPopup, characters, eventSource, event_types, getCurrentChatId, getRequestHeaders, reloadCurrentChat, saveSettingsDebounced, substituteParams, this_chid } from "../../../../script.js";
import { extension_settings, getContext, renderExtensionTemplateAsync, doExtrasFetch, getApiUrl, writeExtensionField } from "../../../extensions.js";
import { selected_group } from "../../../group-chats.js";
import { regex_placement, runRegexScript } from "../../regex/engine.js";
import { isTrueBoolean, download, uuidv4, getFileText } from "../../../utils.js";
import { ARGUMENT_TYPE, SlashCommandArgument, SlashCommandNamedArgument } from "../../../slash-commands/SlashCommandArgument.js";
import { SlashCommandParser } from "../../../slash-commands/SlashCommandParser.js";
import { SlashCommand } from "../../../slash-commands/SlashCommand.js";
import { t } from "../../../i18n.js";
import { MacrosParser } from "../../../../scripts/macros.js";

/**
 * 모듈 이름 상수
 */
const MODULE_NAME = 'character-assets';

/**
 * 정규식 확장 기능 관련 상수
 */
const REGEX_EXTENSION_NAME = 'regex';
const REGEX_SCRIPTS_FIELD = 'scripts';
const BASE_REGEX_FILE = `/scripts/extensions/third-party/${MODULE_NAME}/character-assets_0.json`;

/**
 * 확장자 목록
 */
const ALLOWED_EXTENSIONS = ['png', 'webp', 'gif', 'jpg', 'jpeg'];

/**
 * 기본 이미지 출력 프롬프트
 */
const DEFAULT_IMAGE_PROMPT = `Prompt Instruction for Image Tag Insertion:

When processing the text, insert HTML image tags between paragraphs (i.e., after a full paragraph has ended). For each gap between paragraphs, evaluate the context and, if appropriate, select a matching keyword from the provided list to represent the visual content of that section. Use the following guidelines:

1. Tag Format: Always use the format <img src="keyword">.
2. Context Matching: Choose a keyword from the provided list that fits the context of the text immediately preceding it. If no keyword suitably matches the context, do not insert an image tag.
3. Avoiding Repetition: Ensure that the same keyword is not repeated too frequently. Aim for a diverse set of image tags throughout the document.
4. HTML Familiarity: Since HTML is well understood, use these tags within the text to indicate where images should appear.
5. Flexibility: The instructions should be followed as long as they fit naturally between paragraphs and enrich the content without interrupting the flow of the text.
6. Keyword List: The available keywords are: {{img_keywords}}. Use these keywords to determine the appropriate image tag.`;

/**
 * 정규식 기본값
 */
const DEFAULT_REGEX_FIND = '(?<!\\\\)!\\[([^\\[\\]]+)\\]\\(([^\\(\\)]+)\\)';
const DEFAULT_REGEX_REPLACE = '<div style="display:inline-block; text-align:center; margin: 5px 0;"><img onerror="this.src=\\\'../img/notfound.webp\\\'" class="character_asset" src="$2" /><br /><span style="font-size: 0.8em; opacity: 0.5;">$1</span></div>';

/**
 * 에셋 인터페이스 정의
 * @typedef {Object} Asset
 * @property {string} path - 에셋 경로
 * @property {string} label - 에셋 라벨(키워드)
 */

/**
 * 확장 설정 초기화
 */
function initializeSettings() {
    if (!extension_settings[MODULE_NAME]) {
        extension_settings[MODULE_NAME] = {};
    }

    if (!extension_settings[MODULE_NAME].characterAssets) {
        extension_settings[MODULE_NAME].characterAssets = {};
    }

    if (!extension_settings[MODULE_NAME].imagePrompt) {
        extension_settings[MODULE_NAME].imagePrompt = DEFAULT_IMAGE_PROMPT;
    }

    if (typeof extension_settings[MODULE_NAME].enabled === 'undefined') {
        extension_settings[MODULE_NAME].enabled = true;
    }
}

/**
 * 현재 선택된 캐릭터 정보를 가져옴
 * @returns {object} 캐릭터 정보
 */
function getCurrentCharacter() {
    const context = getContext();
    if (selected_group) {
        return null; // 그룹은 아직 지원하지 않음
    }
    return characters[this_chid];
}

/**
 * 캐릭터의 에셋 정보 초기화
 * @param {string} characterId 캐릭터 ID
 */
function initializeCharacterAssets(characterId) {
    if (!extension_settings[MODULE_NAME].characterAssets[characterId]) {
        extension_settings[MODULE_NAME].characterAssets[characterId] = {
            enabled: true,
            imageKeywords: [],
            regexFind: DEFAULT_REGEX_FIND,
            regexReplace: DEFAULT_REGEX_REPLACE,
            regexOptions: {
                userInput: false,
                aiOutput: true,
                runOnEdit: true,
                onlyFormatDisplay: true
            }
        };
    } else if (!extension_settings[MODULE_NAME].characterAssets[characterId].regexOptions) {
        // 기존 설정에 regexOptions가 없으면 추가
        extension_settings[MODULE_NAME].characterAssets[characterId].regexOptions = {
            userInput: false,
            aiOutput: true,
            runOnEdit: true,
            onlyFormatDisplay: true
        };
    }
}

/**
 * 에셋 정보 가져오기
 * @param {string} characterId 캐릭터 ID
 * @returns {object} 에셋 정보
 */
function getCharacterAssets(characterId) {
    initializeCharacterAssets(characterId);
    return extension_settings[MODULE_NAME].characterAssets[characterId];
}

/**
 * 플레이스홀더 교체
 * @param {string} text 입력 텍스트
 * @param {string} characterId 캐릭터 ID
 * @returns {string} 처리된 텍스트
 */
function replacePlaceholders(text, characterId) {
    const assets = getCharacterAssets(characterId);
    let result = text;

    // {{img_keywords}} 플레이스홀더 교체 (캐릭터별 설정값 사용)
    if (assets && Array.isArray(assets.imageKeywords)) {
        const keywordsList = assets.imageKeywords.join(', ');
        result = result.replace(/\{\{img_keywords\}\}/g, keywordsList);
    }
    
    // {{img_inprompt}} 플레이스홀더 교체 (이미지 출력 프롬프트 전체로 교체)
    if (extension_settings[MODULE_NAME].imagePrompt) {
        result = result.replace(/\{\{img_inprompt\}\}/g, extension_settings[MODULE_NAME].imagePrompt);
    }
    
    return result;
}

/**
 * 캐릭터 에셋 확장 활성화 여부 확인
 * @param {string} characterId 캐릭터 ID
 * @returns {boolean} 활성화 여부
 */
function isCharacterAssetsEnabled(characterId) {
    if (!extension_settings[MODULE_NAME].enabled) {
        return false;
    }

    const assets = getCharacterAssets(characterId);
    return assets && assets.enabled;
}

/**
 * 정규식 스크립트 생성/업데이트 (이제 사용 안함, 참조용)
 * @param {string} characterId 캐릭터 ID
 */
async function createOrUpdateRegexScript(characterId) { 
    // 이 함수는 이제 버튼 클릭으로 직접 호출되지 않습니다.
    // 참조용 또는 다른 로직에서 재사용될 경우를 위해 남겨둡니다.
    // ... (이전 함수 내용) ...
}

/**
 * 캐릭터 에셋을 불러옴
 * @param {string} characterName 캐릭터 이름
 * @returns {Promise<Asset[]>} 에셋 경로 목록
 */
async function fetchCharacterAssets(characterName) {
    try {
        const result = await fetch(`/api/sprites/get?name=${encodeURIComponent(characterName)}`);
        if (!result.ok) {
            return [];
        }
        const data = await result.json();
        return data;
    } catch (error) {
        console.error(`[${MODULE_NAME}] Error fetching assets:`, error);
        return [];
    }
}

/**
 * 에셋 파일명에서 키워드 추출
 * @param {string} fileName 파일명
 * @returns {string} 키워드
 */
function extractKeywordFromFileName(fileName) {
    // 확장자 제거
    return fileName.split('.').slice(0, -1).join('.');
}

/**
 * 캐릭터가 변경되었을 때 호출되는 함수
 */
async function onCharacterChanged() {
    const character = getCurrentCharacter();
    if (!character) {
        $('#character_assets_container').hide();
        return;
    }

    initializeCharacterAssets(String(this_chid));
    updateInterface();
    await loadCharacterAssets();
}

/**
 * 캐릭터의 에셋 로드
 */
async function loadCharacterAssets() {
    const character = getCurrentCharacter();
    if (!character) {
        return;
    }

    const assets = await fetchCharacterAssets(character.avatar.replace(/\.[^/.]+$/, ''));
    const assetsListContainer = $('#character_assets_list');
    assetsListContainer.empty();

    if (assets.length === 0) {
        assetsListContainer.append('<div class="no_assets_message">캐릭터에 연결된 에셋이 없습니다. 에셋을 추가하세요.</div>');
        // 전체 선택 체크박스 비활성화
        $('#select_all_keywords').prop('checked', false).prop('disabled', true);
        $('#delete_selected_keywords').prop('disabled', true);
        return;
    }

    // 전체 선택 및 삭제 버튼 활성화
    $('#select_all_keywords').prop('disabled', false);
    $('#delete_selected_keywords').prop('disabled', false);

    // 키워드별로 에셋 그룹화
    const keywordMap = {};
    assets.forEach(asset => {
        const keyword = asset.label;
        const fullFileNameWithQuery = asset.path.split('/').pop();
        const fileName = fullFileNameWithQuery.split('?')[0];
        if (!keywordMap[keyword]) {
            keywordMap[keyword] = [];
        }
        keywordMap[keyword].push({ fileName: fileName, path: asset.path });
    });

    // 키워드별로 UI 생성
    Object.keys(keywordMap).sort().forEach(keyword => {
        const files = keywordMap[keyword];
        const keywordGroup = $(`
            <div class="keyword-group">
                <div class="keyword-header">
                    <label class="checkbox flex-container flex1">
                        <input type="checkbox" class="keyword-checkbox" data-keyword="${keyword}">
                        <span class="keyword-name">${keyword}</span>
                    </label>
                    <!-- <span class="file-count">(${files.length}개)</span> -->
                </div>
                <div class="file-list"></div>
            </div>
        `);
        const fileListContainer = keywordGroup.find('.file-list');
        files.forEach(file => {
            const fileItem = $(`
                <div class="file-item">
                    <span class="file-name" title="${file.fileName}">${file.fileName}</span>
                    <i class="fa-solid fa-trash delete-asset-button" data-keyword="${keyword}" data-filename="${file.fileName}" title="삭제"></i>
                </div>
            `);
            fileListContainer.append(fileItem);
        });
        assetsListContainer.append(keywordGroup);
    });

    // 삭제 버튼 이벤트 핸들러 연결
    assetsListContainer.off('click', '.delete-asset-button').on('click', '.delete-asset-button', async function() {
        const keyword = $(this).data('keyword');
        const fileName = $(this).data('filename');
        const confirmDelete = await callPopup(`정말로 '${fileName}' 파일을 삭제하시겠습니까?`, 'confirm', undefined, { okButton: '삭제' });
        if (confirmDelete === true) {
            await handleDeleteAsset(keyword, fileName);
        }
    });

    // 키워드 체크박스 변경 시 '전체 선택' 체크박스 상태 업데이트
    assetsListContainer.off('change', '.keyword-checkbox').on('change', '.keyword-checkbox', function() {
        const totalCheckboxes = $('.keyword-checkbox').length;
        const checkedCheckboxes = $('.keyword-checkbox:checked').length;
        $('#select_all_keywords').prop('checked', totalCheckboxes === checkedCheckboxes);
    });

    // '전체 선택' 체크박스 변경 시 모든 키워드 체크박스 상태 변경
    // (이 핸들러는 setupEventHandlers에 있어야 할 수도 있음 - 한 번만 등록)
    //$('#select_all_keywords').off('change').on('change', function() {
    //    $('.keyword-checkbox').prop('checked', $(this).prop('checked'));
    //});

    // '선택 삭제' 버튼 이벤트 핸들러 연결
    // (이 핸들러는 setupEventHandlers에 있어야 할 수도 있음 - 한 번만 등록)
    // $('#delete_selected_keywords').off('click').on('click', async function() {
    //     // ... 삭제 로직 ...
    // });
    
    // 초기 전체 선택 상태 설정
    $('#select_all_keywords').prop('checked', false);
}

/**
 * 개별 에셋 파일 삭제
 * @param {string} keyword 삭제할 파일의 키워드 (label)
 * @param {string} fileName 삭제할 파일명 (확장자 포함)
 */
async function handleDeleteAsset(keyword, fileName) {
    const character = getCurrentCharacter();
    if (!character) {
        showToast('error', '캐릭터가 선택되지 않았습니다.');
        return;
    }

    const characterName = character.avatar.replace(/\.[^/.]+$/, '');
    // spriteName은 확장자를 제외한 파일명이어야 함
    const spriteName = fileName.split('.').slice(0, -1).join('.'); 

    try {
        const response = await jQuery.ajax({
            type: 'POST',
            url: '/api/sprites/delete',
            data: JSON.stringify({ 
                name: characterName, // 캐릭터 이름
                label: keyword,      // 키워드 (label)
                spriteName: spriteName // 확장자 제외 파일명 (spriteName)
            }),
            contentType: 'application/json',
            cache: false
        });

        showToast('success', `'${fileName}' 파일이 삭제되었습니다.`);
        await loadCharacterAssets(); // 목록 새로고침

    } catch (error) {
        console.error(`[${MODULE_NAME}] Error deleting asset:`, error);
        const errorText = error.responseText || '알 수 없는 오류';
        showToast('error', `파일 삭제 중 오류 발생: ${errorText}`, '삭제 실패');
    }
}

/**
 * 인터페이스 업데이트
 */
function updateInterface() {
    const character = getCurrentCharacter();
    if (!character) {
        $('#character_assets_container').hide();
        return;
    }

    const assets = getCharacterAssets(String(this_chid));
    
    // 활성화 상태 업데이트
    $('#character_assets_enabled').prop('checked', assets.enabled);
    
    // 정규식 설정 업데이트
    $('#character_assets_regex_find').val(assets.regexFind || DEFAULT_REGEX_FIND);
    $('#character_assets_regex_replace').val(assets.regexReplace || DEFAULT_REGEX_REPLACE);
    
    // 정규식 옵션 체크박스 업데이트
    const regexOptions = assets.regexOptions || {
        userInput: false,
        aiOutput: true,
        runOnEdit: true,
        onlyFormatDisplay: true
    };
    
    $('#regex_user_input').prop('checked', regexOptions.userInput);
    $('#regex_ai_output').prop('checked', regexOptions.aiOutput);
    $('#regex_run_on_edit').prop('checked', regexOptions.runOnEdit);
    $('#regex_only_format_display').prop('checked', regexOptions.onlyFormatDisplay);

    // 전역 이미지 프롬프트 업데이트
    $('#character_assets_image_prompt').val(extension_settings[MODULE_NAME].imagePrompt || DEFAULT_IMAGE_PROMPT);

    $('#character_assets_container').show();
}

// 페이지에 toastr 라이브러리가 로드되었는지 확인하는 헬퍼 함수
function showToast(type, message, title = '', options = {}) {
    // toastr 객체가 있는지 확인
    if (typeof toastr !== 'undefined') {
        // 기본 옵션 설정
        const defaultOptions = { timeOut: 3000, extendedTimeOut: 1000 };
        const mergedOptions = { ...defaultOptions, ...options };
        
        // 타입에 따라 토스트 표시
        switch (type) {
            case 'error':
                toastr.error(message, title, mergedOptions);
                break;
            case 'success':
                toastr.success(message, title, mergedOptions);
                break;
            case 'warning':
                toastr.warning(message, title, mergedOptions);
                break;
            case 'info':
                toastr.info(message, title, mergedOptions);
                break;
            default:
                console.log(message); // 폴백으로 콘솔에 출력
        }
    } else {
        // toastr이 없으면 콘솔에 출력
        console.log(`[${type.toUpperCase()}] ${title ? title + ': ' : ''}${message}`);
    }
    
    // 후처리를 위해 토스트 ID를 반환 (toastr이 있는 경우만)
    return typeof toastr !== 'undefined' ? toastr : null;
}

/**
 * ZIP 파일 업로드 처리
 * @param {File} file ZIP 파일
 */
async function handleZipUpload(file) {
    const character = getCurrentCharacter();
    if (!character) {
        showToast('error', '선택된 캐릭터가 없습니다.');
        return;
    }

    const formData = new FormData();
    formData.append('name', character.avatar.replace(/\.[^/.]+$/, ''));
    formData.append('avatar', file);

    const uploadToast = showToast('info', '업로드 중...', '처리 중입니다', { timeOut: 0, extendedTimeOut: 0 });

    try {
        // jQuery.ajax 사용 및 headers 제거
        const result = await jQuery.ajax({
            type: 'POST',
            url: '/api/sprites/upload-zip',
            data: formData,
            processData: false,
            contentType: false,
            cache: false
        });

        if (uploadToast) uploadToast.clear();
        showToast('success', `${result.count}개의 이미지가 업로드되었습니다.`, '업로드 성공');
        
        // 새로 업로드된 에셋 로드 및 자동 선택
        const assets = await fetchCharacterAssets(character.avatar.replace(/\.[^/.]+$/, ''));
        
        // 기존 이미지 키워드 목록 가져오기
        const characterAssets = getCharacterAssets(String(this_chid));
        const existingKeywords = characterAssets.imageKeywords || [];
        
        // 새 키워드 추출
        const newKeywords = new Set();
        assets.forEach(asset => {
            newKeywords.add(asset.label);
        });
        
        // 기존 키워드에 새 키워드 추가 (중복 방지)
        const updatedKeywords = [...existingKeywords];
        
        for (const keyword of newKeywords) {
            if (!existingKeywords.includes(keyword)) {
                updatedKeywords.push(keyword);
            }
        }
        
        // 새 키워드 목록 저장
        characterAssets.imageKeywords = updatedKeywords;
        saveSettingsDebounced();
        
        // UI 새로고침
        await loadCharacterAssets();

    } catch (error) {
        if (uploadToast) uploadToast.clear();
        console.error(`[${MODULE_NAME}] Error uploading ZIP:`, error);
        const errorText = error.responseText || '알 수 없는 오류';
        showToast('error', `업로드 중 오류가 발생했습니다. ${errorText}`, '업로드 실패');
    }
}

/**
 * 개별 이미지 파일 업로드
 * @param {File} file 이미지 파일
 * @param {string} label 라벨(키워드)
 * @returns {Promise<boolean>} 업로드 성공 여부
 */
async function handleImageUpload(file, label) {
    const character = getCurrentCharacter();
    if (!character) {
        showToast('error', '선택된 캐릭터가 없습니다.');
        return false;
    }

    const characterName = character.avatar.replace(/\.[^/.]+$/, '');
    const formData = new FormData();
    formData.append('name', characterName);
    formData.append('label', label);
    formData.append('avatar', file);
    formData.append('spriteName', label);
    
    try {
        // jQuery.ajax 사용 및 headers 제거
        await jQuery.ajax({
            type: 'POST',
            url: '/api/sprites/upload',
            data: formData,
            processData: false,
            contentType: false,
            cache: false
        });

        // 기존 이미지 키워드 목록 가져오기
        const characterAssets = getCharacterAssets(String(this_chid));
        const existingKeywords = characterAssets.imageKeywords || [];
        
        // 새 키워드가 목록에 없으면 추가
        if (!existingKeywords.includes(label)) {
            existingKeywords.push(label);
            characterAssets.imageKeywords = existingKeywords;
            saveSettingsDebounced();
        }
        
        return true;

    } catch (error) {
        console.error(`[${MODULE_NAME}] Image upload failed:`, error);
        // 오류 토스트는 setupEventHandlers에서 처리
        return false;
    }
}

/**
 * 이벤트 핸들러 설정
 */
function setupEventHandlers() {
    // 전역 활성화 상태 변경
    $('#character_assets_global_enabled').on('change', function() {
        extension_settings[MODULE_NAME].enabled = $(this).prop('checked');
        saveSettingsDebounced();
    });

    // 캐릭터별 활성화 상태 변경
    $('#character_assets_enabled').on('change', function() {
        const assets = getCharacterAssets(String(this_chid));
        assets.enabled = $(this).prop('checked');
        saveSettingsDebounced();
        // createOrUpdateRegexScript(String(this_chid)); // 더 이상 호출 안 함
    });

    // 정규식 설정 변경
    $('#character_assets_regex_find').on('change', function() {
        const assets = getCharacterAssets(String(this_chid));
        assets.regexFind = $(this).val();
        saveSettingsDebounced();
        // createOrUpdateRegexScript(String(this_chid)); // 더 이상 호출 안 함
    });

    $('#character_assets_regex_replace').on('change', function() {
        const assets = getCharacterAssets(String(this_chid));
        assets.regexReplace = $(this).val();
        saveSettingsDebounced();
        // createOrUpdateRegexScript(String(this_chid)); // 더 이상 호출 안 함
    });

    // 새로운 정규식 옵션 UI 변경 이벤트
    $('#regex_user_input').on('change', function() {
        const assets = getCharacterAssets(String(this_chid));
        if (!assets.regexOptions) {
            assets.regexOptions = {};
        }
        assets.regexOptions.userInput = $(this).prop('checked');
        saveSettingsDebounced();
        // createOrUpdateRegexScript(String(this_chid)); // 더 이상 호출 안 함
    });

    $('#regex_ai_output').on('change', function() {
        const assets = getCharacterAssets(String(this_chid));
        if (!assets.regexOptions) {
            assets.regexOptions = {};
        }
        assets.regexOptions.aiOutput = $(this).prop('checked');
        saveSettingsDebounced();
        // createOrUpdateRegexScript(String(this_chid)); // 더 이상 호출 안 함
    });

    $('#regex_run_on_edit').on('change', function() {
        const assets = getCharacterAssets(String(this_chid));
        if (!assets.regexOptions) {
            assets.regexOptions = {};
        }
        assets.regexOptions.runOnEdit = $(this).prop('checked');
        saveSettingsDebounced();
        // createOrUpdateRegexScript(String(this_chid)); // 더 이상 호출 안 함
    });

    $('#regex_only_format_display').on('change', function() {
        const assets = getCharacterAssets(String(this_chid));
        if (!assets.regexOptions) {
            assets.regexOptions = {};
        }
        assets.regexOptions.onlyFormatDisplay = $(this).prop('checked');
        saveSettingsDebounced();
        // createOrUpdateRegexScript(String(this_chid)); // 더 이상 호출 안 함
    });

    // 이미지 프롬프트 변경
    $('#character_assets_image_prompt').on('change', function() {
        extension_settings[MODULE_NAME].imagePrompt = $(this).val();
        saveSettingsDebounced();
    });

    // 이미지 프롬프트 초기화
    $('#character_assets_reset_prompt').on('click', function() {
        $('#character_assets_image_prompt').val(DEFAULT_IMAGE_PROMPT);
        extension_settings[MODULE_NAME].imagePrompt = DEFAULT_IMAGE_PROMPT;
        saveSettingsDebounced();
    });

    // 플레이스홀더 교체 버튼
    $('#replace_keywords_placeholder_btn').on('click', async function() {
        const character = getCurrentCharacter();
        if (!character) {
            showToast('error', '교체할 키워드를 가져오려면 캐릭터가 선택되어야 합니다.');
            return;
        }
        const characterName = character.avatar.replace(/\.[^/.]+$/, '');
        const assets = await fetchCharacterAssets(characterName);

        if (assets.length === 0) {
            showToast('warning', '현재 캐릭터에 등록된 에셋이 없습니다.');
            return;
        }

        const fileNames = assets.map(asset => {
            const fullFileNameWithQuery = asset.path.split('/').pop();
            return fullFileNameWithQuery.split('?')[0]; // 쿼리 스트링 제거된 파일명
        }).join(', '); // 쉼표와 공백으로 구분

        const currentPrompt = $('#character_assets_image_prompt').val();
        if (currentPrompt.includes('{{img_keywords}}')) {
            const newPrompt = currentPrompt.replace(/\{\{img_keywords\}\}/g, fileNames);
            $('#character_assets_image_prompt').val(newPrompt);
            extension_settings[MODULE_NAME].imagePrompt = newPrompt;
            saveSettingsDebounced();
            showToast('success', '{{img_keywords}} 플레이스홀더가 파일명 목록으로 교체되었습니다.');
        } else {
            showToast('info', '현재 프롬프트에 {{img_keywords}} 플레이스홀더가 없습니다.');
        }
    });

    // 프롬프트 복사 버튼
    $('#copy_image_prompt_btn').on('click', function() {
        const promptText = $('#character_assets_image_prompt').val();
        navigator.clipboard.writeText(promptText).then(() => {
            showToast('success', '이미지 출력 프롬프트가 클립보드에 복사되었습니다.');
        }, (err) => {
            showToast('error', '프롬프트 복사에 실패했습니다.');
            console.error('Clipboard copy failed:', err);
        });
    });

    // 정규식 초기화
    $('#character_assets_reset_regex').on('click', function() {
        $('#character_assets_regex_find').val(DEFAULT_REGEX_FIND);
        $('#character_assets_regex_replace').val(DEFAULT_REGEX_REPLACE);
        
        // 기본 옵션 체크박스 설정
        $('#regex_user_input').prop('checked', false);
        $('#regex_ai_output').prop('checked', true);
        $('#regex_run_on_edit').prop('checked', true);
        $('#regex_only_format_display').prop('checked', true);
        
        const assets = getCharacterAssets(String(this_chid));
        assets.regexFind = DEFAULT_REGEX_FIND;
        assets.regexReplace = DEFAULT_REGEX_REPLACE;
        
        // 옵션 초기화
        assets.regexOptions = {
            userInput: false,
            aiOutput: true,
            runOnEdit: true,
            onlyFormatDisplay: true
        };
        
        saveSettingsDebounced();
        // createOrUpdateRegexScript(String(this_chid)); // 더 이상 호출 안 함
    });

    // ZIP 파일 업로드
    $('#character_assets_upload_zip').on('change', async function(e) {
        const file = e.target.files[0];
        if (!file) {
            return;
        }
        
        if (file.type === 'application/zip' || file.type === 'application/x-zip-compressed' || file.name.endsWith('.zip')) {
            await handleZipUpload(file);
        } else {
            showToast('error', 'ZIP 파일만 업로드 가능합니다.', '잘못된 파일 형식');
        }
        // 파일 입력 필드 초기화
        $(this).val('');
    });

    // 개별 이미지 업로드
    $('#character_assets_upload_image').on('change', async function(e) {
        const files = e.target.files;
        if (!files || files.length === 0) {
            return;
        }
        
        const uploadPromises = [];
        let invalidFiles = [];
        
        for (const file of files) {
            const fileExt = file.name.split('.').pop().toLowerCase();
            
            if (!ALLOWED_EXTENSIONS.includes(fileExt)) {
                invalidFiles.push(file.name);
                continue;
            }
            
            // 파일명에서 키워드 자동 추출 (확장자 제외)
            const label = extractKeywordFromFileName(file.name);
            
            if (!label) {
                showToast('warning', `파일명에서 키워드를 추출할 수 없습니다: ${file.name}`, '경고');
                continue;
            }
            
            uploadPromises.push(handleImageUpload(file, label));
        }
        
        if (invalidFiles.length > 0) {
            showToast('error', `지원되지 않는 파일 형식: ${invalidFiles.join(', ')}`, '잘못된 파일 형식');
        }
        
        if (uploadPromises.length > 0) {
            const uploadToast = showToast('info', `${uploadPromises.length}개의 이미지 업로드 중...`, '처리 중', { timeOut: 0, extendedTimeOut: 0 });
            
            try {
                await Promise.all(uploadPromises);
                if (uploadToast) uploadToast.clear();
                showToast('success', `${uploadPromises.length}개의 이미지가 성공적으로 업로드되었습니다.`, '업로드 완료');
                await loadCharacterAssets();
            } catch (error) {
                if (uploadToast) uploadToast.clear();
                showToast('error', '일부 파일 업로드 중 오류가 발생했습니다.', '업로드 실패');
                console.error('[CHARACTER-ASSETS] Upload error:', error);
                await loadCharacterAssets();
            }
        }
        
        // 파일 입력 필드 초기화
        $(this).val('');
    });

    // ZIP 파일 업로드 버튼 클릭
    $('#character_assets_upload_zip_btn').on('click', function() {
        $('#character_assets_upload_zip').trigger('click');
    });

    // 개별 이미지 업로드 버튼 클릭
    $('#character_assets_upload_image_btn').on('click', function() {
        $('#character_assets_upload_image').attr('multiple', true);
        $('#character_assets_upload_image').trigger('click');
    });

    // '전체 선택' 체크박스 변경 시 모든 키워드 체크박스 상태 변경
    $('#select_all_keywords').off('change').on('change', function() {
        $('.keyword-checkbox').prop('checked', $(this).prop('checked'));
    });

    // '선택 삭제' 버튼 이벤트 핸들러 연결
    $('#delete_selected_keywords').off('click').on('click', async function() {
        const selectedKeywords = [];
        $('.keyword-checkbox:checked').each(function() {
            selectedKeywords.push($(this).data('keyword'));
        });

        if (selectedKeywords.length === 0) {
            showToast('warning', '삭제할 키워드를 선택해주세요.');
            return;
        }

        const confirmDelete = await callPopup(
            `선택된 ${selectedKeywords.length}개의 키워드와 관련된 모든 파일을 삭제하시겠습니까?<br><br><b>${selectedKeywords.join(', ')}</b>`,
            'confirm',
            undefined,
            { okButton: '삭제' }
        );

        if (confirmDelete === true) {
            const deletePromises = [];
            const character = getCurrentCharacter();
            const characterName = character?.avatar?.replace(/\.[^/.]+$/, '');

            if (!characterName) {
                showToast('error', '캐릭터 정보를 가져올 수 없습니다.');
                return;
            }

            showToast('info', '선택된 키워드 삭제 중...', '처리 중', { timeOut: 0, extendedTimeOut: 0 });

            // 각 선택된 키워드에 대해 파일 목록 가져와서 삭제 요청 생성
            const assets = await fetchCharacterAssets(characterName); 
            selectedKeywords.forEach(keyword => {
                const filesToDelete = assets.filter(asset => asset.label === keyword);
                filesToDelete.forEach(asset => {
                    const fullFileNameWithQuery = asset.path.split('/').pop();
                    const fileName = fullFileNameWithQuery.split('?')[0];
                    const spriteName = fileName.split('.').slice(0, -1).join('.');

                    deletePromises.push(jQuery.ajax({
                        type: 'POST',
                        url: '/api/sprites/delete',
                        data: JSON.stringify({ 
                            name: characterName,
                            label: keyword,
                            spriteName: spriteName
                        }),
                        contentType: 'application/json',
                        cache: false
                    }));
                });
            });

            try {
                await Promise.all(deletePromises);
                showToast('success', '선택된 키워드가 모두 삭제되었습니다.');
                await loadCharacterAssets(); // 목록 새로고침
                $('#select_all_keywords').prop('checked', false); // 전체 선택 해제
            } catch (error) {
                console.error(`[${MODULE_NAME}] Error deleting selected assets:`, error);
                const errorText = error.responseText || '알 수 없는 오류';
                showToast('error', `선택된 키워드 삭제 중 오류 발생: ${errorText}`, '삭제 실패');
            }
        }
    });
}

/**
 * 메시지 전송 전 이벤트 핸들러 (img_keywords 치환용)
 * @param {object} data 이벤트 데이터
 */
function onMessageSend(data) {
    const character = getCurrentCharacter();
    if (!character || !isCharacterAssetsEnabled(String(this_chid))) {
        return;
    }

    // 여기서 replacePlaceholders는 {{img_keywords}} 만 처리 (만약 필요하다면)
    data.message = replacePlaceholders(data.message, String(this_chid));
}

/**
 * 이미지 확장 초기화
 */
async function initializeExtension() {
    // 기본 설정값 초기화
    initializeSettings();

    // HTML 로드 및 삽입
    const html = await $.get(`/scripts/extensions/third-party/${MODULE_NAME}/templates/settings.html`);
    $('#extensions_settings').append(html);

    // 설정 패널에 이벤트 핸들러 연결
    setupEventHandlers();

    // 현재 캐릭터 에셋 로드
    onCharacterChanged();

    // 이벤트 리스너 등록
    eventSource.on(event_types.CHAT_CHANGED, onCharacterChanged);
    eventSource.on(event_types.MESSAGE_SENT, onMessageSend);
    eventSource.on(event_types.MESSAGE_SWIPED, onMessageSend);

    // 전역 매크로 시스템에 플레이스홀더 등록
    if (typeof MacrosParser !== 'undefined' && MacrosParser.registerMacro) {
        // {{img_inprompt}} 매크로 등록 - 이미지 출력 프롬프트 전체 반환
        MacrosParser.registerMacro('img_inprompt', () => extension_settings[MODULE_NAME].imagePrompt || DEFAULT_IMAGE_PROMPT, '캐릭터 에셋 이미지 출력 프롬프트');
        
        // {{img_keywords}} 매크로 등록 - 현재 캐릭터의 이미지 키워드 목록 반환
        MacrosParser.registerMacro('img_keywords', () => {
            const assets = getCharacterAssets(String(this_chid));
            return assets && Array.isArray(assets.imageKeywords) ? assets.imageKeywords.join(', ') : '';
        }, '현재 캐릭터의 이미지 키워드 목록');
        
        console.log(`[${MODULE_NAME}] 매크로 등록 완료: img_inprompt, img_keywords`);
    }
    
    console.debug(`[${MODULE_NAME}] 확장 초기화 완료`);
}

/**
 * / 명령어: 에셋 업로드
 */
function uploadAssetCommand(args, url) {
    if (!url) {
        showToast('error', '업로드할 이미지 URL을 입력해주세요.');
        return '';
    }

    const character = getCurrentCharacter();
    if (!character) {
        showToast('error', '선택된 캐릭터가 없습니다.');
        return '';
    }

    const label = args.label;
    if (!label) {
        showToast('error', '키워드(라벨)를 지정해주세요.');
        return '';
    }

    // URL에서 이미지 다운로드 후 업로드
    fetch(url)
        .then(response => response.blob())
        .then(blob => {
            const file = new File([blob], `${label}.png`, { type: 'image/png' });
            handleImageUpload(file, label);
        })
        .catch(error => {
            console.error(`[${MODULE_NAME}] Error downloading image:`, error);
            showToast('error', '이미지 다운로드 중 오류가 발생했습니다.');
        });

    return `키워드 "${label}"로 이미지 업로드를 시작합니다...`;
}

$(document).ready(function() {
    // 확장 초기화
    initializeExtension();
    
    // 슬래시 명령어 등록
    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'assets-upload',
        aliases: ['업로드에셋'],
        callback: uploadAssetCommand,
        namedArgumentList: [
            SlashCommandNamedArgument.fromProps({
                name: 'label',
                description: '이미지에 적용할 키워드(라벨)',
                typeList: [ARGUMENT_TYPE.STRING],
                isRequired: true
            })
        ],
        unnamedArgumentList: [
            SlashCommandArgument.fromProps({
                description: '업로드할 이미지 URL',
                typeList: [ARGUMENT_TYPE.STRING],
                isRequired: true
            })
        ],
        helpString: '이미지 URL을 통해 캐릭터 에셋을 업로드합니다.'
    }));
}); 