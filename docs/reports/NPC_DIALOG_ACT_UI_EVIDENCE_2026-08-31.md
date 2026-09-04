# Ctrl+F12 `#ACT` UI command evidence ledger

Status date: 2026-08-31. This ledger records local help/manual evidence only. It
does not claim a local preview can create a real game-client window, submit a
server action, execute an `@` label, or reproduce client pixels.

## Evidence policy

Every command below is eligible only for **Partial simulation**. The preview
may draw a labelled card containing statically proven text, geometry and asset
references. `@` labels must remain display-only. A source expression such as
`<$...>` must be classified dynamic and must not borrow a preceding `MOV`
value. Invalid static fields must be marked instead of silently clamped.

| Command | GOM evidence | GEE/LFM evidence | 996PC evidence | Preview boundary |
| --- | --- | --- | --- | --- |
| `MESSAGEBOX` | `knowledge/gom/manual/扩展MessageBox.md`: `MessageBox 信息 @确定 @取消`; rich label/color text is mentioned, buttons not supported in that text syntax. | `knowledge/lfm/manual/扩展MessageBox.md`: same three-part form. | `knowledge/996pc/manual/扩展MessageBox.md`: same form, whitespace restriction and color writing example. `data/functions-996pc.json` records name-only catalog state despite local extracted manual. | Draw text and optional confirm/cancel labels as non-clicking display chips; no label execution. |
| `SHOWPROGRESSBARDLG` | `knowledge/gom/manual/自定义采集.md`: 5 fields: seconds, completion label, text, interrupt switch, interrupt label. | `knowledge/lfm/manual/自定义采集功能.md`: five base fields plus seven custom fields. | `knowledge/996pc/manual/自定义采集.md`: five base fields; `data/functions-996pc.json` remains name-only. | Draw a static progress card only; no timer completion/cancellation or label execution. |
| `PLAYWINDOWEFFECT` | `knowledge/gom/manual/播放窗口特效PlayWindowEffect.md`: 10 fields, including target window 0-9, effect 0-7, WIL, start/end, interval, repeats, offsets, draw/top mode. | No local LFM command page found in the extracted manual. | `knowledge/996pc/manual/播放窗口特效PlayWindowEffect.md`: same documented ten fields, while `functions-996pc.json` remains name-only. | Draw a bounded effect card/placeholder; missing cache or an unsupported window attachment is not a client effect. |
| `SENDMOVEHINTMSG` | `data/commands.json`, GOM variant: message, colors, X/Y, field 6 `屏幕坐标模式`. | `knowledge/lfm/manual/NPC对话框提示文字命令-NPC界面上向上滚动提示信息.md`: field 6 is residence seconds, `0` or omitted defaults to 3. | No independent 996PC page found in local extracted manual. | Draw a non-animated local hint card. Never transfer GOM field-6 meaning to GEE/LFM. |
| `OPENUPGRADEDLG` | `knowledge/gom/manual/打开OK对话框.md`: title, client item-slot window, `@UpgradeDlgItem` follows click. | `knowledge/lfm/manual/打开OK对话框.md`: same title and trigger, says it is current NPC script. | `knowledge/996pc/manual/打开OK对话框.md`: same title/trigger, and QF/QM `SETCURRNPC` context. | Draw title plus `Runtime-data blocked` item-slot boundary. Do not permit inserting an item or executing `@UpgradeDlgItem`. |
| `OPENCLIENTDLG` | `knowledge/gom/manual/打开客户端界面功能.md`: 0 no coordinate / 1 set / 2 close; IDs 15 bag, 16 equipment, 17 skills; ID 19 map has additional fields 5/6. | `knowledge/lfm/manual/打开客户端界面功能.md`: only 0/1; IDs 15 built-in assistant, 16 M-map, 17 bag. | No independent local 996PC extracted page found. | Draw an ID-table-labelled card; never open, close or navigate an external/host window. |

## GEE/LFM custom progress offset conflict

The extracted LFM page exposes incompatible ordering statements for custom
`SHOWPROGRESSBARDLG` offsets:

1. its parameter listing says parameter 6 is the progress X/Y offset and
   parameter 7 is the text X/Y offset;
2. its syntax/summary order is `[文字偏移] [进度条偏移]`;
3. its example comment calls `15,12` text offset and `17,29` progress offset.

Therefore a GEE/LFM preview must retain both source pairs and state
`Evidence-blocked`; it must not select, swap, or visibly apply either pair as
authoritative geometry. The standard five fields remain independently
displayable.

## Recommended typed contract

```ts
type DialogActUiCommand =
  | 'messagebox' | 'show-progress-bar' | 'play-window-effect'
  | 'send-move-hint' | 'open-upgrade-dialog' | 'open-client-dialog';

interface DialogActUiPreview {
  command: DialogActUiCommand;
  simulation: 'partial';
  localOnly: true;
  sourceRange: { start: number; end: number };
  fields: Array<{
    name: string;
    status: 'static' | 'dynamic' | 'invalid' | 'evidence-blocked';
    value?: string | number | boolean | [number, number];
  }>;
  dynamicFields?: string[];
  invalidFields?: string[];
  evidenceStatus?: 'evidence-blocked';
}
```

`NpcDialogDocumentModel.actUiPreviews` should preserve source order. The
renderer should expose a visible `.act-ui-preview-card` for each entry with
`data-act-ui-command`, `data-act-ui-simulation="partial"`, field-status data
attributes and a `local-only / display-only` boundary. This is deliberately a
separate overlay from `#SAY` canvas geometry.
