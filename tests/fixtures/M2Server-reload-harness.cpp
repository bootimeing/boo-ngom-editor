#ifndef UNICODE
#define UNICODE
#endif
#ifndef _UNICODE
#define _UNICODE
#endif

#include <windows.h>

namespace {

constexpr int kReloadAllNpc = 17;

LRESULT CALLBACK WindowProc(HWND hwnd, UINT message, WPARAM wparam, LPARAM lparam) {
  if (message == WM_COMMAND && LOWORD(wparam) == kReloadAllNpc) {
    Sleep(2000);
    return 0;
  }
  if (message == WM_DESTROY) {
    PostQuitMessage(0);
    return 0;
  }
  return DefWindowProcW(hwnd, message, wparam, lparam);
}

} // namespace

int wmain() {
  const HINSTANCE instance = GetModuleHandleW(nullptr);
  const wchar_t* className = L"BooM2ReloadHarness";
  WNDCLASSW windowClass = {};
  windowClass.lpfnWndProc = WindowProc;
  windowClass.hInstance = instance;
  windowClass.lpszClassName = className;
  if (!RegisterClassW(&windowClass)) return 1;

  const HWND hwnd = CreateWindowExW(
    0, className, L"BOO M2 reload integration harness", WS_OVERLAPPEDWINDOW,
    CW_USEDEFAULT, CW_USEDEFAULT, 320, 200,
    nullptr, nullptr, instance, nullptr);
  if (hwnd == nullptr) return 2;

  const HMENU root = CreateMenu();
  const HMENU control = CreatePopupMenu();
  const HMENU reload = CreatePopupMenu();
  AppendMenuW(reload, MF_STRING, kReloadAllNpc, L"所有NPC");
  AppendMenuW(control, MF_POPUP, reinterpret_cast<UINT_PTR>(reload), L"重新加载");
  AppendMenuW(root, MF_POPUP, reinterpret_cast<UINT_PTR>(control), L"控制");
  SetMenu(hwnd, root);

  MSG message = {};
  while (GetMessageW(&message, nullptr, 0, 0) > 0) {
    TranslateMessage(&message);
    DispatchMessageW(&message);
  }
  return 0;
}
