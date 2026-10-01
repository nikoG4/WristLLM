import { px } from "@zos/utils";
import { DEVICE_WIDTH, DEVICE_HEIGHT } from "../../../utils/config/device";

const SIDE_PADDING = px(18);
const BUTTON_GAP = px(8);
const BUTTON_HEIGHT = px(48);
const BUTTON_WIDTH = (DEVICE_WIDTH - SIDE_PADDING * 2 - BUTTON_GAP * 3) / 4;
const FOOTER_Y = DEVICE_HEIGHT - px(64);
const COMPOSER_HEIGHT = px(78);

export const LAYOUT = {
  sidePadding: SIDE_PADDING,
  headerY: px(20),
  statusY: px(56),
  transcriptY: px(92),
  transcriptHeight: DEVICE_HEIGHT - px(92) - COMPOSER_HEIGHT - px(84),
  composerY: FOOTER_Y - COMPOSER_HEIGHT - px(10),
  composerHeight: COMPOSER_HEIGHT,
  footerY: FOOTER_Y,
  buttonWidth: BUTTON_WIDTH,
  buttonHeight: BUTTON_HEIGHT,
  buttonGap: BUTTON_GAP,
};
