import { BasePage } from "@zeppos/zml/base-page";
import {
  createWidget,
  deleteWidget,
  widget,
  prop,
  align,
  text_style,
  createKeyboard,
  deleteKeyboard,
  inputType,
} from "@zos/ui";
import { setScrollMode, SCROLL_MODE_FREE, scrollTo, getScrollTop } from "@zos/page";
import { px, log as Logger } from "@zos/utils";
import { create as createMedia, id as mediaId, codec as mediaCodec } from "@zos/media";
import { DEVICE_WIDTH, DEVICE_HEIGHT } from "../../../utils/config/device";
import { COLORS } from "../../../utils/config/constants";
import { readJsonFile, readTextFile, writeJsonFile, writeTextFile } from "../../../utils/fs";
import { LAYOUT } from "zosLoader:./index.page.[pf].layout.js";

const HISTORY_FILE = "chat_history.json";
const COMPOSER_FILE = "composer.txt";
const SCROLL_FILE = "chat_scroll.txt";
const RECORD_FILE = "data://voice_input.opus";
const MAX_COMPOSER_LENGTH = 240;
const STREAM_STEP_FAST = 18;
const STREAM_STEP_MEDIUM = 10;
const STREAM_STEP_SLOW = 6;
const T9_KEYS = [
  { label: "1", chars: ["1"] },
  { label: "2", chars: ["A", "B", "C"] },
  { label: "3", chars: ["D", "E", "F"] },
  { label: "4", chars: ["G", "H", "I"] },
  { label: "5", chars: ["J", "K", "L"] },
  { label: "6", chars: ["M", "N", "O"] },
  { label: "7", chars: ["P", "Q", "R", "S"] },
  { label: "8", chars: ["T", "U", "V"] },
  { label: "9", chars: ["W", "X", "Y", "Z"] },
];

const logger = Logger.getLogger("wristllm-home-page");

function clampComposer(text) {
  return String(text || "").slice(0, MAX_COMPOSER_LENGTH);
}

function sanitizeHistory(history) {
  if (!Array.isArray(history)) {
    return [];
  }

  return history
    .filter((item) => item && typeof item.text === "string" && item.text.trim())
    .map((item) => ({
      role: item.role === "assistant" ? "assistant" : "user",
      text: item.text.trim(),
    }))
    .slice(-24);
}

function normalizeMessageText(text) {
  return String(text || "")
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function estimateTextHeight(text, width, textSize) {
  const lines = String(text || "")
    .split("\n")
    .reduce((total, line) => {
      const charsPerLine = Math.max(1, Math.floor(width / Math.max(1, textSize * 0.52)));
      return total + Math.max(1, Math.ceil(Math.max(1, line.length) / charsPerLine));
    }, 0);

  return px(lines * textSize * 1.58 + 28);
}

function applyCharacterCase(char, isUppercase) {
  if (!/[A-Z]/i.test(char)) {
    return char;
  }

  return isUppercase ? char.toUpperCase() : char.toLowerCase();
}

function getKeyboardPreviewText(text) {
  const normalized = String(text || "");
  if (!normalized) {
    return "(empty)";
  }

  const compact = normalized.replace(/\s+/g, " ");
  return compact.length > 30 ? `...${compact.slice(-30)}` : compact;
}

Page(
  BasePage({
    state: {
      history: [],
      composer: "",
      status: "Loading...",
      providerConfigured: false,
      providerLabel: "AI",
      modelName: "",
      isLoading: false,
      keyboardVisible: false,
      keyboardWidgets: [],
      keyboardPreviewWidget: null,
      charPickerWidgets: [],
      nativeKeyboardOpen: false,
      keyboardUppercase: false,
      isRecording: false,
      hasRecorder: false,
      recorder: null,
      dynamicWidgets: [],
      hasRestoredScroll: false,
      streamTimerId: null,
      contentBottom: px(0),
      scrollY: 0,
    },

    onInit() {
      this.state.history = sanitizeHistory(readJsonFile(HISTORY_FILE, []));
      this.state.composer = clampComposer(readTextFile(COMPOSER_FILE, ""));
      this.state.scrollY = parseInt(readTextFile(SCROLL_FILE, "0"), 10) || 0;
      this.state.hasRecorder = typeof createMedia === "function";
    },

    build() {
      this.createBaseUI();
      this.renderAll();
      this.requestInitialState();
    },

    createBaseUI() {
      createWidget(widget.FILL_RECT, {
        x: 0,
        y: 0,
        w: DEVICE_WIDTH,
        h: DEVICE_HEIGHT,
        color: COLORS.background,
      });

      setScrollMode({
        mode: SCROLL_MODE_FREE,
        options: {
          height: px(DEVICE_HEIGHT),
          count: 10,
        },
      });

      createWidget(widget.PAGE_SCROLLBAR);

      this.headerWidget = createWidget(widget.TEXT, {
        x: LAYOUT.sidePadding,
        y: LAYOUT.headerY,
        w: DEVICE_WIDTH - LAYOUT.sidePadding * 2,
        h: px(26),
        text: "WristLLM",
        text_size: px(24),
        color: COLORS.text,
        align_h: align.LEFT,
      });

      this.statusWidget = createWidget(widget.TEXT, {
        x: LAYOUT.sidePadding,
        y: LAYOUT.statusY,
        w: DEVICE_WIDTH - LAYOUT.sidePadding * 2,
        h: px(38),
        text: "",
        text_size: px(15),
        color: COLORS.textMuted,
        text_style: text_style.WRAP,
      });
    },

    requestInitialState() {
      this.request({ method: "GET_STATE" })
        .then((data) => {
          this.applyServiceState(data?.state);
        })
        .catch(() => {
          this.state.status = "Phone service unavailable. Local chat history loaded.";
          this.renderAll();
        });
    },

    applyServiceState(state) {
      if (state && typeof state === "object") {
        this.state.providerConfigured = Boolean(state.providerConfigured);
        this.state.providerLabel = state.providerLabel || "AI";
        this.state.modelName = state.modelName || "";

        if (state.pendingDraft) {
          this.state.status = "Phone draft ready. Tap Voice to import.";
        } else if (!this.state.providerConfigured) {
          this.state.status = `Configure ${this.state.providerLabel} in phone settings.`;
        } else if (!this.state.isLoading && !this.hasActiveStream() && !this.state.isRecording) {
          this.state.status = this.state.modelName
            ? `Ready · ${this.state.providerLabel} · ${this.state.modelName}`
            : `Ready · ${this.state.providerLabel}`;
        }
      }

      this.renderAll();
    },

    persistState() {
      writeJsonFile(HISTORY_FILE, sanitizeHistory(this.state.history));
      writeTextFile(COMPOSER_FILE, this.state.composer);
    },

    setStatus(message) {
      this.state.status = String(message || "");
      this.renderStatus();
    },

    renderStatus() {
      this.statusWidget.setProperty(prop.TEXT, this.state.status);
    },

    clearDynamicWidgets() {
      this.state.dynamicWidgets.forEach((item) => deleteWidget(item));
      this.state.dynamicWidgets = [];
    },

    clearStreamTimer() {
      if (this.state.streamTimerId) {
        clearTimeout(this.state.streamTimerId);
        this.state.streamTimerId = null;
      }
    },

    hasActiveStream() {
      return Boolean(this.state.streamTimerId);
    },

    scrollToBottom() {
      const target = Math.max(0, this.state.contentBottom - px(DEVICE_HEIGHT) + px(8));
      scrollTo({ y: target });
    },

    scheduleScrollToBottom(delay = 40) {
      setTimeout(() => {
        this.scrollToBottom();
      }, delay);
    },

    renderEmptyState(startY) {
      const widgets = [];
      const x = LAYOUT.sidePadding;
      const y = startY;
      const w = DEVICE_WIDTH - LAYOUT.sidePadding * 2;
      const text =
        "Ask an AI model from your watch.\n\nType with the T9 keyboard, import a phone draft with Voice, and send short prompts for the best experience.";
      const textH = estimateTextHeight(text, w - px(24), px(16));
      const h = textH + px(48);

      widgets.push(
        createWidget(widget.FILL_RECT, {
          x,
          y,
          w,
          h,
          radius: px(18),
          color: COLORS.panelAlt,
        })
      );
      widgets.push(
        createWidget(widget.TEXT, {
          x: x + px(12),
          y: y + px(12),
          w: w - px(24),
          h: px(20),
          text: "Start a Conversation",
          text_size: px(18),
          color: COLORS.text,
        })
      );
      widgets.push(
        createWidget(widget.TEXT, {
          x: x + px(12),
          y: y + px(34),
          w: w - px(24),
          h: textH,
          text,
          text_size: px(16),
          color: COLORS.textMuted,
          text_style: text_style.WRAP,
        })
      );

      this.state.dynamicWidgets.push(...widgets);
      return y + h + px(14);
    },

    renderMessageBubble(message, startY) {
      const role = message.role === "assistant" ? "assistant" : "user";
      const bubbleWidth =
        role === "assistant"
          ? DEVICE_WIDTH - LAYOUT.sidePadding * 2 - px(28)
          : DEVICE_WIDTH - LAYOUT.sidePadding * 2 - px(62);
      const bubbleX =
        role === "assistant"
          ? LAYOUT.sidePadding
          : DEVICE_WIDTH - LAYOUT.sidePadding - bubbleWidth;
      const labelText = role === "assistant" ? this.state.providerLabel : "You";
      const labelColor = role === "assistant" ? COLORS.textDim : COLORS.accent;
      const bubbleColor = role === "assistant" ? COLORS.assistantBubble : COLORS.userBubble;
      const contentColor = role === "assistant" ? COLORS.assistantText : COLORS.userText;
      const text = normalizeMessageText(message.text);
      const textSize = px(17);
      const textInset = px(12);
      const textHeight = estimateTextHeight(text || " ", bubbleWidth - textInset * 2, textSize);
      const bubbleY = startY + px(16);
      const bubbleH = Math.max(px(42), textHeight + px(16));

      this.state.dynamicWidgets.push(
        createWidget(widget.TEXT, {
          x: bubbleX,
          y: startY,
          w: bubbleWidth,
          h: px(15),
          text: labelText,
          text_size: px(13),
          color: labelColor,
          align_h: role === "assistant" ? align.LEFT : align.RIGHT,
        })
      );
      this.state.dynamicWidgets.push(
        createWidget(widget.FILL_RECT, {
          x: bubbleX,
          y: bubbleY,
          w: bubbleWidth,
          h: bubbleH,
          radius: px(16),
          color: bubbleColor,
        })
      );
      this.state.dynamicWidgets.push(
        createWidget(widget.TEXT, {
          x: bubbleX + textInset,
          y: bubbleY + px(8),
          w: bubbleWidth - textInset * 2,
          h: textHeight,
          text: text || " ",
          text_size: textSize,
          color: contentColor,
          text_style: text_style.WRAP,
          align_h: align.LEFT,
        })
      );

      return bubbleY + bubbleH + px(14);
    },

    renderLoadingBubble(startY) {
      const loadingMessage = {
        role: "assistant",
        text: "Thinking...",
      };
      return this.renderMessageBubble(loadingMessage, startY);
    },

    renderMessageArea(startY) {
      let currentY = startY;
      if (!this.state.history.length && !this.state.isLoading) {
        return this.renderEmptyState(currentY);
      }

      this.state.history.forEach((message) => {
        currentY = this.renderMessageBubble(message, currentY);
      });

      if (this.state.isLoading) {
        currentY = this.renderLoadingBubble(currentY);
      }

      return currentY;
    },

    renderComposerCard(startY) {
      if (this.state.keyboardVisible) {
        return startY;
      }

      const x = LAYOUT.sidePadding;
      const y = startY;
      const w = DEVICE_WIDTH - LAYOUT.sidePadding * 2;
      const h = px(86);
      const preview = this.state.composer || "Draft is empty";
      const counterText = `${this.state.composer.length}/${MAX_COMPOSER_LENGTH}`;

      this.state.dynamicWidgets.push(
        createWidget(widget.FILL_RECT, {
          x,
          y,
          w,
          h,
          radius: px(16),
          color: COLORS.panel,
        })
      );
      this.state.dynamicWidgets.push(
        createWidget(widget.TEXT, {
          x: x + px(12),
          y: y + px(10),
          w: w - px(24),
          h: px(16),
          text: "Draft",
          text_size: px(14),
          color: COLORS.textDim,
        })
      );
      this.state.dynamicWidgets.push(
        createWidget(widget.TEXT, {
          x: x + px(12),
          y: y + px(28),
          w: w - px(24),
          h: px(38),
          text: preview,
          text_size: px(17),
          color: this.state.composer ? COLORS.text : COLORS.textMuted,
          text_style: text_style.WRAP,
        })
      );
      this.state.dynamicWidgets.push(
        createWidget(widget.TEXT, {
          x: x + px(12),
          y: y + px(68),
          w: w - px(24),
          h: px(14),
          text: counterText,
          text_size: px(12),
          color: COLORS.textDim,
          align_h: align.RIGHT,
        })
      );

      return y + h + px(12);
    },

    renderActionRow(startY) {
      if (this.state.keyboardVisible) {
        return startY;
      }

      const buttons = [
        { text: "Type", color: COLORS.accent, handler: () => this.openKeyboard() },
        { text: "Send", color: COLORS.success, handler: () => this.sendComposer() },
        { text: "Voice", color: COLORS.accent, handler: () => this.loadPhoneDraft() },
      ];

      if (this.state.hasRecorder) {
        buttons.push({
          text: this.state.isRecording ? "Stop" : "Rec",
          color: this.state.isRecording ? COLORS.danger : COLORS.warning,
          handler: () => this.toggleRecorder(),
        });
      }

      buttons.push({
        text: "Clr",
        color: COLORS.danger,
        handler: () => this.clearConversation(),
      });

      const gap = px(8);
      const buttonWidth =
        (DEVICE_WIDTH - LAYOUT.sidePadding * 2 - gap * (buttons.length - 1)) / buttons.length;
      const buttonHeight = px(44);

      buttons.forEach((item, index) => {
        this.state.dynamicWidgets.push(
          createWidget(widget.BUTTON, {
            x: LAYOUT.sidePadding + index * (buttonWidth + gap),
            y: startY,
            w: buttonWidth,
            h: buttonHeight,
            radius: px(12),
            normal_color: item.color,
            press_color: item.color,
            text: item.text,
            text_size: px(15),
            click_func: item.handler,
          })
        );
      });

      return startY + buttonHeight + px(18);
    },

    renderAll() {
      this.renderStatus();
      this.clearDynamicWidgets();

      let currentY = this.renderMessageArea(LAYOUT.transcriptY);
      currentY = this.renderComposerCard(currentY);
      currentY = this.renderActionRow(currentY);

      this.state.contentBottom = currentY;

      setScrollMode({
        mode: SCROLL_MODE_FREE,
        options: {
          height: Math.max(px(DEVICE_HEIGHT), currentY),
          count: 10,
        },
      });

      if (!this.state.hasRestoredScroll) {
        this.state.hasRestoredScroll = true;
        if (this.state.scrollY > 0) {
          scrollTo({ y: this.state.scrollY });
        }
      }

      if (this.state.keyboardPreviewWidget) {
        this.state.keyboardPreviewWidget.setProperty(
          prop.TEXT,
          getKeyboardPreviewText(this.state.composer)
        );
      }
    },

    hasNativeKeyboard() {
      return typeof createKeyboard === "function" && typeof deleteKeyboard === "function";
    },

    canUseNativeVoice() {
      return this.hasNativeKeyboard() && inputType && typeof inputType.VOICE !== "undefined";
    },

    canUseNativeCharKeyboard() {
      return this.hasNativeKeyboard() && inputType && typeof inputType.CHAR !== "undefined";
    },

    openNativeKeyboard(mode) {
      if (!this.hasNativeKeyboard()) {
        return false;
      }

      const desiredInputType = mode === "voice" ? inputType?.VOICE : inputType?.CHAR;
      if (typeof desiredInputType === "undefined") {
        return false;
      }

      try {
        this.state.nativeKeyboardOpen = true;
        createKeyboard({
          inputType: desiredInputType,
          text: this.state.composer || "",
          onComplete: (_, result) => {
            this.state.nativeKeyboardOpen = false;
            deleteKeyboard();
            this.state.composer = clampComposer(result?.data || "");
            this.persistState();
            this.renderAll();
            this.setStatus(
              mode === "voice" ? "Native voice input imported" : "Native keyboard input ready"
            );
          },
          onCancel: () => {
            this.state.nativeKeyboardOpen = false;
            deleteKeyboard();
            this.setStatus(
              mode === "voice" ? "Native voice input cancelled" : "Native keyboard cancelled"
            );
          },
        });
        return true;
      } catch (error) {
        logger.warn("openNativeKeyboard failed", error);
        this.state.nativeKeyboardOpen = false;
        return false;
      }
    },

    addCharacter(char) {
      this.state.composer = clampComposer(this.state.composer + char);
      this.persistState();
      this.renderAll();
    },

    backspaceComposer() {
      this.state.composer = this.state.composer.slice(0, -1);
      this.persistState();
      this.renderAll();
    },

    destroyKeyboardWidgets() {
      this.state.keyboardWidgets.forEach((item) => deleteWidget(item));
      this.state.keyboardWidgets = [];
      this.state.keyboardPreviewWidget = null;
      this.closeCharPicker();
    },

    closeKeyboard() {
      this.state.keyboardVisible = false;
      this.destroyKeyboardWidgets();
      this.renderAll();
    },

    toggleKeyboardCase() {
      this.state.keyboardUppercase = !this.state.keyboardUppercase;
      this.rebuildKeyboard();
    },

    openKeyboard() {
      if (this.state.keyboardVisible || this.state.nativeKeyboardOpen) {
        return;
      }

      if (this.canUseNativeCharKeyboard() && this.openNativeKeyboard("text")) {
        this.setStatus("Using native system keyboard");
        return;
      }

      this.state.keyboardVisible = true;
      this.setStatus("Using watch T9 keyboard");
      this.rebuildKeyboard();
    },

    closeCharPicker() {
      this.state.charPickerWidgets.forEach((item) => deleteWidget(item));
      this.state.charPickerWidgets = [];
    },

    openCharPicker(keyDef) {
      this.closeCharPicker();

      const chars = keyDef.chars.map((char) =>
        applyCharacterCase(char, this.state.keyboardUppercase)
      );

      if (chars.length === 1) {
        this.addCharacter(chars[0]);
        return;
      }

      const overlayX = px(26);
      const overlayY = px(78);
      const overlayW = DEVICE_WIDTH - px(52);
      const overlayH = px(142);
      const gap = px(8);
      const buttonWidth = (overlayW - px(24) - gap * (chars.length - 1)) / chars.length;

      this.state.charPickerWidgets = [
        createWidget(widget.FILL_RECT, {
          x: overlayX,
          y: overlayY,
          w: overlayW,
          h: overlayH,
          radius: px(16),
          color: 0x040404,
        }),
        createWidget(widget.TEXT, {
          x: overlayX + px(12),
          y: overlayY + px(12),
          w: overlayW - px(24),
          h: px(18),
          text: `Choose: ${chars.join(" ")}`,
          text_size: px(15),
          color: COLORS.text,
          align_h: align.CENTER_H,
        }),
      ];

      chars.forEach((char, index) => {
        this.state.charPickerWidgets.push(
          this.createKeyboardButton(
            overlayX + px(12) + index * (buttonWidth + gap),
            overlayY + px(42),
            buttonWidth,
            px(52),
            char,
            () => {
              this.addCharacter(char);
              this.closeCharPicker();
            },
            COLORS.accent,
            18
          )
        );
      });

      this.state.charPickerWidgets.push(
        this.createKeyboardButton(
          overlayX + px(12),
          overlayY + px(106),
          overlayW - px(24),
          px(24),
          "Cancel",
          () => this.closeCharPicker(),
          COLORS.danger,
          13
        )
      );
    },

    createKeyboardButton(x, y, w, h, label, handler, color = COLORS.accent, textSize = 16) {
      return createWidget(widget.BUTTON, {
        x,
        y,
        w,
        h,
        radius: px(12),
        normal_color: color,
        press_color: color,
        text: label,
        text_size: px(textSize),
        click_func: handler,
      });
    },

    rebuildKeyboard() {
      this.destroyKeyboardWidgets();
      this.state.keyboardVisible = true;
      this.renderAll();

      const overlayX = px(8);
      const overlayY = px(56);
      const overlayW = DEVICE_WIDTH - px(16);
      const overlayH = DEVICE_HEIGHT - px(72);
      const rowGap = px(10);
      const keyGap = px(8);
      const rowHeight = px(64);
      const contentX = overlayX + px(10);
      const contentW = overlayW - px(20);
      const gridTop = overlayY + px(74);
      const keyWidth = (contentW - keyGap * 2) / 3;

      this.state.keyboardWidgets = [
        createWidget(widget.FILL_RECT, {
          x: overlayX,
          y: overlayY,
          w: overlayW,
          h: overlayH,
          radius: px(18),
          color: COLORS.panelSoft,
        }),
        createWidget(widget.TEXT, {
          x: contentX,
          y: overlayY + px(10),
          w: contentW,
          h: px(22),
          text: `T9 Keyboard ${this.state.keyboardUppercase ? "ABC" : "abc"}`,
          text_size: px(18),
          color: COLORS.text,
          align_h: align.CENTER_H,
        }),
      ];

      this.state.keyboardPreviewWidget = createWidget(widget.TEXT, {
        x: contentX,
        y: overlayY + px(38),
        w: contentW,
        h: px(20),
        text: getKeyboardPreviewText(this.state.composer),
        text_size: px(15),
        color: COLORS.textMuted,
        text_style: text_style.NONE,
      });

      this.state.keyboardWidgets.push(this.state.keyboardPreviewWidget);

      T9_KEYS.forEach((keyDef, index) => {
        const row = Math.floor(index / 3);
        const col = index % 3;
        const x = contentX + col * (keyWidth + keyGap);
        const y = gridTop + row * (rowHeight + rowGap);
        const secondary = keyDef.chars
          .map((char) => applyCharacterCase(char, this.state.keyboardUppercase))
          .join("");

        this.state.keyboardWidgets.push(
          createWidget(widget.BUTTON, {
            x,
            y,
            w: keyWidth,
            h: rowHeight,
            radius: px(16),
            normal_color: COLORS.accent,
            press_color: COLORS.accentPress,
            text: `${keyDef.label}\n${secondary}`,
            text_size: px(16),
            click_func: () => this.openCharPicker(keyDef),
          })
        );
      });

      const actionY = gridTop + 3 * (rowHeight + rowGap) + px(4);
      const actionGap = px(8);
      const actionWidth = (contentW - actionGap * 3) / 4;
      const actions = [
        { label: "Shift", color: COLORS.warning, handler: () => this.toggleKeyboardCase() },
        { label: "Space", color: COLORS.accent, handler: () => this.addCharacter(" ") },
        { label: "Bk", color: COLORS.danger, handler: () => this.backspaceComposer() },
        { label: "OK", color: COLORS.success, handler: () => this.closeKeyboard() },
      ];

      actions.forEach((item, index) => {
        this.state.keyboardWidgets.push(
          this.createKeyboardButton(
            contentX + index * (actionWidth + actionGap),
            actionY,
            actionWidth,
            px(42),
            item.label,
            item.handler,
            item.color,
            15
          )
        );
      });
    },

    clearConversation() {
      this.clearStreamTimer();
      this.state.history = [];
      this.persistState();
      this.setStatus("Conversation cleared");
      this.renderAll();
      this.scheduleScrollToBottom();
    },

    toggleRecorder() {
      if (!this.state.hasRecorder) {
        this.setStatus("Audio recorder is not available on this device runtime.");
        return;
      }

      if (this.state.isRecording) {
        this.stopRecorder();
      } else {
        this.startRecorder();
      }
    },

    startRecorder() {
      if (typeof createMedia !== "function") {
        this.setStatus("Recorder API is not available in this runtime.");
        return;
      }

      if (!mediaId || typeof mediaId.RECORDER === "undefined") {
        this.setStatus("Recorder type is not exposed by this device runtime.");
        return;
      }

      if (!mediaCodec || typeof mediaCodec.OPUS === "undefined") {
        this.setStatus("OPUS recording codec is not exposed by this device runtime.");
        return;
      }

      let recorder;
      try {
        recorder = createMedia(mediaId.RECORDER);
      } catch (error) {
        logger.warn("create recorder failed", error);
        this.state.hasRecorder = false;
        this.setStatus("Could not create watch recorder.");
        this.renderAll();
        return;
      }

      try {
        if (recorder && typeof recorder.addEventListener === "function") {
          recorder.addEventListener((result) => {
            logger.log("recorder event", JSON.stringify(result));
          });
        }
      } catch (error) {
        logger.warn("recorder addEventListener failed", error);
      }

      try {
        recorder.setFormat(mediaCodec.OPUS, {
          target_file: RECORD_FILE,
        });
      } catch (error) {
        logger.warn("recorder setFormat failed", error);
        this.state.hasRecorder = false;
        this.setStatus("Could not configure watch recorder.");
        this.renderAll();
        return;
      }

      try {
        recorder.start();
        this.state.recorder = recorder;
        this.state.isRecording = true;
        this.setStatus("Recording from watch... tap Stop to finish.");
        this.renderAll();
      } catch (error) {
        logger.warn("recorder start failed", error);
        this.state.recorder = null;
        this.state.isRecording = false;
        this.state.hasRecorder = false;
        this.setStatus("Watch recorder is not usable on this runtime.");
        this.renderAll();
      }
    },

    stopRecorder() {
      try {
        if (this.state.recorder) {
          this.state.recorder.stop();
        }
      } catch (error) {
        logger.warn("stopRecorder failed", error);
      }

      this.state.recorder = null;
      this.state.isRecording = false;
      this.setStatus(
        "Watch recording saved. AI audio transcription is not auto-wired yet for this OPUS file."
      );
      this.renderAll();
    },

    loadPhoneDraft() {
      if (this.state.nativeKeyboardOpen) {
        return;
      }

      if (this.canUseNativeVoice() && this.openNativeKeyboard("voice")) {
        this.setStatus("Using native voice input");
        return;
      }

      this.setStatus("Checking phone draft...");

      this.request({ method: "CONSUME_PENDING_DRAFT" })
        .then((data) => {
          this.applyServiceState(data?.state);

          if (data?.draft) {
            this.state.composer = clampComposer(data.draft);
            this.persistState();
            this.renderAll();
            this.setStatus("Phone draft imported");
          } else {
            this.setStatus("No draft found. Use phone settings and your phone mic, then tap Voice.");
          }
        })
        .catch(() => {
          this.setStatus("Phone service unavailable while loading draft.");
        });
    },

    startReplyStream(fullText) {
      const reply = normalizeMessageText(fullText);
      if (!reply) {
        this.setStatus("The AI provider returned an empty response.");
        return;
      }

      this.clearStreamTimer();
      this.state.history.push({
        role: "assistant",
        text: "",
      });
      this.persistState();
      this.setStatus("Receiving reply...");
      this.renderAll();
      this.scheduleScrollToBottom(0);

      const assistantIndex = this.state.history.length - 1;

      const step = () => {
        const current = this.state.history[assistantIndex];
        if (!current) {
          this.clearStreamTimer();
          return;
        }

        const currentLength = current.text.length;
        const remaining = reply.length - currentLength;
        const increment =
          remaining > 180
            ? STREAM_STEP_FAST
            : remaining > 80
              ? STREAM_STEP_MEDIUM
              : STREAM_STEP_SLOW;

        current.text = reply.slice(0, currentLength + increment);
        this.persistState();
        this.renderAll();
        this.scrollToBottom();

        if (current.text.length < reply.length) {
          this.state.streamTimerId = setTimeout(
            step,
            current.text.endsWith("\n") ? 85 : 35
          );
          return;
        }

        this.state.streamTimerId = null;
        this.setStatus("Reply received");
        this.persistState();
        this.renderAll();
        this.scheduleScrollToBottom(0);
      };

      step();
    },

    sendComposer() {
      if (this.state.isLoading || this.hasActiveStream()) {
        this.setStatus("Wait until the current AI reply finishes.");
        return;
      }

      const userText = clampComposer(this.state.composer.trim());

      if (!userText) {
        this.setStatus("Write something first.");
        return;
      }

      if (!this.state.providerConfigured) {
        this.setStatus(`Configure ${this.state.providerLabel} in phone settings first.`);
        return;
      }

      this.state.history.push({
        role: "user",
        text: userText,
      });
      this.state.composer = "";
      this.state.isLoading = true;
      this.persistState();
      this.renderAll();
      this.setStatus(`${this.state.providerLabel} is thinking...`);
      this.scheduleScrollToBottom(0);

      this.request({
        method: "SEND_MESSAGE",
        params: {
          history: sanitizeHistory(this.state.history),
        },
      })
        .then((data) => {
          this.state.isLoading = false;
          this.applyServiceState(data?.state);

          if (!data?.ok || !data?.reply) {
            this.setStatus(data?.error || "The AI provider returned an empty response.");
            this.renderAll();
            return;
          }

          this.startReplyStream(data.reply);
        })
        .catch((error) => {
          logger.warn("SEND_MESSAGE failed", error);
          this.state.isLoading = false;
          this.setStatus(`Could not reach ${this.state.providerLabel}. Check phone connectivity.`);
          this.renderAll();
        });
    },

    onCall(data) {
      if (data?.type === "SETTINGS_UPDATED") {
        this.applyServiceState(data.state);
      }
    },

    onDestroy() {
      this.state.scrollY = getScrollTop();
      this.clearStreamTimer();

      if (this.state.nativeKeyboardOpen && this.hasNativeKeyboard()) {
        deleteKeyboard();
      }

      if (this.state.isRecording) {
        this.stopRecorder();
      }

      writeTextFile(SCROLL_FILE, String(this.state.scrollY || 0));
      this.persistState();
      this.destroyKeyboardWidgets();
      this.clearDynamicWidgets();
    },
  })
);
