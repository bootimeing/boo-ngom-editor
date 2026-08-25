#ifndef UNICODE
#define UNICODE
#endif
#ifndef _UNICODE
#define _UNICODE
#endif

#include <windows.h>
#include <tlhelp32.h>

#include <algorithm>
#include <cerrno>
#include <climits>
#include <cstdint>
#include <cstdlib>
#include <cwchar>
#include <cwctype>
#include <iostream>
#include <sstream>
#include <string>
#include <unordered_set>
#include <vector>

namespace {

constexpr UINT kWmCommand = 0x0111;
constexpr UINT kMenuByPosition = 0x0400;
constexpr int kMaxMenuText = 256;
constexpr UINT kReloadTimeoutMs = 15000;

struct MenuWindowCandidate {
	HWND hwnd;
	std::wstring title;
	bool isM2;
};

struct EnumWindowContext {
	const std::unordered_set<DWORD>* processIds;
	std::vector<MenuWindowCandidate>* candidates;
	std::unordered_set<HWND>* seen;
};

struct ReloadSendResult {
	bool success;
	int failedId;
	DWORD error;
	ULONGLONG elapsedMs;
};

void WriteBytes(HANDLE handle, const std::string& value) {
	const char* cursor = value.data();
	size_t remaining = value.size();
	while (remaining > 0) {
		DWORD written = 0;
		const DWORD chunk = static_cast<DWORD>(std::min<size_t>(remaining, MAXDWORD));
		if (!WriteFile(handle, cursor, chunk, &written, nullptr) || written == 0) {
			return;
		}
		cursor += written;
		remaining -= written;
	}
}

void WriteLine(HANDLE handle, const std::string& value) {
	WriteBytes(handle, value);
	if (value.empty() || value.back() != '\n') {
		WriteBytes(handle, "\n");
	}
}

void WriteStdout(const std::string& value) {
	WriteLine(GetStdHandle(STD_OUTPUT_HANDLE), value);
}

void WriteStderr(const std::string& value) {
	WriteLine(GetStdHandle(STD_ERROR_HANDLE), value);
}

std::string WideToUtf8(const std::wstring& value) {
	if (value.empty()) {
		return {};
	}
	const int length = WideCharToMultiByte(
		CP_UTF8, 0, value.data(), static_cast<int>(value.size()), nullptr, 0, nullptr, nullptr);
	if (length <= 0) {
		return {};
	}
	std::string result(static_cast<size_t>(length), '\0');
	WideCharToMultiByte(
		CP_UTF8, 0, value.data(), static_cast<int>(value.size()), result.data(), length, nullptr, nullptr);
	return result;
}

std::wstring Utf8ToWide(const std::string& value) {
	if (value.empty()) {
		return {};
	}
	int length = MultiByteToWideChar(
		CP_UTF8, MB_ERR_INVALID_CHARS, value.data(), static_cast<int>(value.size()), nullptr, 0);
	DWORD flags = MB_ERR_INVALID_CHARS;
	if (length <= 0) {
		flags = 0;
		length = MultiByteToWideChar(
			CP_UTF8, flags, value.data(), static_cast<int>(value.size()), nullptr, 0);
	}
	if (length <= 0) {
		return {};
	}
	std::wstring result(static_cast<size_t>(length), L'\0');
	MultiByteToWideChar(
		CP_UTF8, flags, value.data(), static_cast<int>(value.size()), result.data(), length);
	return result;
}

bool IsAsciiWhitespace(unsigned char value) {
	return value == ' ' || value == '\t' || value == '\r' || value == '\n';
}

std::string TrimCopy(const std::string& value) {
	size_t first = 0;
	while (first < value.size() && IsAsciiWhitespace(static_cast<unsigned char>(value[first]))) {
		++first;
	}
	size_t last = value.size();
	while (last > first && IsAsciiWhitespace(static_cast<unsigned char>(value[last - 1]))) {
		--last;
	}
	return value.substr(first, last - first);
}

std::vector<std::string> Split(const std::string& value, char delimiter) {
	std::vector<std::string> result;
	size_t start = 0;
	for (;;) {
		const size_t position = value.find(delimiter, start);
		if (position == std::string::npos) {
			result.push_back(value.substr(start));
			return result;
		}
		result.push_back(value.substr(start, position - start));
		start = position + 1;
	}
}

bool TryParseInt(const std::string& value, int& result) {
	const std::string trimmed = TrimCopy(value);
	if (trimmed.empty()) {
		return false;
	}
	errno = 0;
	char* end = nullptr;
	const long parsed = std::strtol(trimmed.c_str(), &end, 10);
	if (errno == ERANGE || end == trimmed.c_str() || *end != '\0' || parsed < INT_MIN || parsed > INT_MAX) {
		return false;
	}
	result = static_cast<int>(parsed);
	return true;
}

bool TryParseWideInt(const std::wstring& value, int& result) {
	if (value.empty()) {
		return false;
	}
	errno = 0;
	wchar_t* end = nullptr;
	const long parsed = std::wcstol(value.c_str(), &end, 10);
	if (errno == ERANGE || end == value.c_str() || *end != L'\0' || parsed < INT_MIN || parsed > INT_MAX) {
		return false;
	}
	result = static_cast<int>(parsed);
	return true;
}

bool TryParseWindowHandle(const std::wstring& value, HWND& result) {
	if (value.empty()) {
		return false;
	}
	errno = 0;
	wchar_t* end = nullptr;
	const unsigned long long parsed = std::wcstoull(value.c_str(), &end, 10);
	if (errno == ERANGE || end == value.c_str() || *end != L'\0') {
		return false;
	}
	result = reinterpret_cast<HWND>(static_cast<uintptr_t>(parsed));
	return result != nullptr;
}

std::string WindowHandleToString(HWND hwnd) {
	return std::to_string(static_cast<unsigned long long>(reinterpret_cast<uintptr_t>(hwnd)));
}

std::string JoinStrings(const std::vector<std::string>& values, const char* separator) {
	std::ostringstream output;
	for (size_t index = 0; index < values.size(); ++index) {
		if (index > 0) {
			output << separator;
		}
		output << values[index];
	}
	return output.str();
}

std::string JoinInts(const std::vector<int>& values) {
	std::ostringstream output;
	for (size_t index = 0; index < values.size(); ++index) {
		if (index > 0) {
			output << ',';
		}
		output << values[index];
	}
	return output.str();
}

std::wstring GetMenuText(HMENU menu, int position) {
	wchar_t buffer[kMaxMenuText] = {};
	const int length = GetMenuStringW(
		menu, static_cast<UINT>(position), buffer, kMaxMenuText, kMenuByPosition);
	return length > 0 ? std::wstring(buffer, static_cast<size_t>(length)) : std::wstring();
}

std::wstring GetWindowTitle(HWND hwnd) {
	wchar_t buffer[kMaxMenuText] = {};
	const int length = GetWindowTextW(hwnd, buffer, kMaxMenuText);
	return length > 0 ? std::wstring(buffer, static_cast<size_t>(length)) : std::wstring();
}

bool MenuContainsText(HMENU menu, const std::wstring& text, int depth = 0) {
	if (menu == nullptr || depth > 20) {
		return false;
	}
	const int count = GetMenuItemCount(menu);
	for (int index = 0; index < count && index < 50; ++index) {
		if (GetMenuText(menu, index).find(text) != std::wstring::npos) {
			return true;
		}
		const HMENU submenu = GetSubMenu(menu, index);
		if (submenu != nullptr && MenuContainsText(submenu, text, depth + 1)) {
			return true;
		}
	}
	return false;
}

void CollectMenuWindow(
	HWND hwnd,
	const std::unordered_set<DWORD>& processIds,
	std::vector<MenuWindowCandidate>& candidates,
	std::unordered_set<HWND>& seen,
	int depth) {
	if (hwnd == nullptr || depth > 6) {
		return;
	}

	DWORD processId = 0;
	GetWindowThreadProcessId(hwnd, &processId);
	const bool belongsToM2 = processIds.find(processId) != processIds.end();
	if (belongsToM2) {
		const HMENU menu = GetMenu(hwnd);
		if (menu != nullptr && GetMenuItemCount(menu) > 0 && seen.insert(hwnd).second) {
			candidates.push_back({ hwnd, GetWindowTitle(hwnd), MenuContainsText(menu, L"所有NPC") });
		}
	}

	for (HWND child = GetWindow(hwnd, GW_CHILD); child != nullptr; child = GetWindow(child, GW_HWNDNEXT)) {
		CollectMenuWindow(child, processIds, candidates, seen, depth + 1);
	}
}

BOOL CALLBACK EnumWindowsCallback(HWND hwnd, LPARAM parameter) {
	auto* context = reinterpret_cast<EnumWindowContext*>(parameter);
	// Newer engine controllers embed the M2 window below a controller-owned parent.
	// Walk every top-level tree and only filter when collecting menu candidates.
	CollectMenuWindow(
		hwnd, *context->processIds, *context->candidates, *context->seen, 0);
	return TRUE;
}

std::unordered_set<DWORD> FindM2ProcessIds() {
	std::unordered_set<DWORD> processIds;
	const HANDLE snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
	if (snapshot == INVALID_HANDLE_VALUE) {
		return processIds;
	}

	PROCESSENTRY32W entry = {};
	entry.dwSize = sizeof(entry);
	if (Process32FirstW(snapshot, &entry)) {
		do {
			if (_wcsicmp(entry.szExeFile, L"m2server.exe") == 0 ||
				_wcsicmp(entry.szExeFile, L"m2server") == 0) {
				processIds.insert(entry.th32ProcessID);
			}
		} while (Process32NextW(snapshot, &entry));
	}
	CloseHandle(snapshot);
	return processIds;
}

std::wstring LowercaseCopy(std::wstring value) {
	std::transform(value.begin(), value.end(), value.begin(), [](wchar_t character) {
		return static_cast<wchar_t>(std::towlower(character));
	});
	return value;
}

bool ContainsCaseInsensitive(const std::wstring& value, const std::wstring& search) {
	return LowercaseCopy(value).find(LowercaseCopy(search)) != std::wstring::npos;
}

std::wstring NormalizePathForComparison(std::wstring value) {
	std::replace(value.begin(), value.end(), L'/', L'\\');
	while (value.size() > 3 && value.back() == L'\\') {
		value.pop_back();
	}
	return LowercaseCopy(value);
}

bool TryGetProcessImagePath(DWORD processId, std::wstring& imagePath) {
	const HANDLE process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, processId);
	if (process == nullptr) {
		return false;
	}

	std::vector<wchar_t> buffer(32768, L'\0');
	DWORD length = static_cast<DWORD>(buffer.size());
	const BOOL succeeded = QueryFullProcessImageNameW(process, 0, buffer.data(), &length);
	CloseHandle(process);
	if (!succeeded || length == 0) {
		return false;
	}

	imagePath.assign(buffer.data(), static_cast<size_t>(length));
	return true;
}

std::unordered_set<DWORD> FindM2ProcessIdsForPath(const std::wstring& expectedPath) {
	const std::wstring normalizedExpected = NormalizePathForComparison(expectedPath);
	std::unordered_set<DWORD> matches;
	for (DWORD processId : FindM2ProcessIds()) {
		std::wstring imagePath;
		if (TryGetProcessImagePath(processId, imagePath) &&
			NormalizePathForComparison(imagePath) == normalizedExpected) {
			matches.insert(processId);
		}
	}
	return matches;
}

bool IsM2ProcessId(DWORD processId) {
	const std::unordered_set<DWORD> processIds = FindM2ProcessIds();
	return processIds.find(processId) != processIds.end();
}

HWND FindMenuWindowForProcessIds(const std::unordered_set<DWORD>& processIds) {
	if (processIds.empty()) {
		return nullptr;
	}

	std::vector<MenuWindowCandidate> candidates;
	std::unordered_set<HWND> seen;
	EnumWindowContext context = { &processIds, &candidates, &seen };
	EnumWindows(EnumWindowsCallback, reinterpret_cast<LPARAM>(&context));
	if (candidates.empty()) {
		return nullptr;
	}

	for (const MenuWindowCandidate& candidate : candidates) {
		if (candidate.isM2) {
			return candidate.hwnd;
		}
	}
	for (const MenuWindowCandidate& candidate : candidates) {
		if (ContainsCaseInsensitive(candidate.title, L"M2Server")) {
			return candidate.hwnd;
		}
	}
	for (const MenuWindowCandidate& candidate : candidates) {
		if (ContainsCaseInsensitive(candidate.title, L"M2")) {
			return candidate.hwnd;
		}
	}
	return candidates.front().hwnd;
}

HWND FindMenuWindow() {
	return FindMenuWindowForProcessIds(FindM2ProcessIds());
}

HWND FindMenuWindowForProcessId(DWORD processId) {
	const std::unordered_set<DWORD> processIds = { processId };
	return FindMenuWindowForProcessIds(processIds);
}

HWND FindMenuWindowForPath(const std::wstring& expectedPath) {
	return FindMenuWindowForProcessIds(FindM2ProcessIdsForPath(expectedPath));
}

DWORD GetWindowProcessId(HWND hwnd) {
	DWORD processId = 0;
	GetWindowThreadProcessId(hwnd, &processId);
	return processId;
}

std::wstring CleanMenuText(const std::wstring& value) {
	std::wstring result;
	result.reserve(value.size());
	for (wchar_t character : value) {
		if (character != L'&') {
			result.push_back(character);
		}
	}
	return result;
}

int MenuFindId(HMENU menu, const std::wstring& name, int depth = 0) {
	if (menu == nullptr || depth > 20) {
		return -1;
	}
	const int count = GetMenuItemCount(menu);

	for (int index = 0; index < count && index < 50; ++index) {
		const UINT id = GetMenuItemID(menu, index);
		if (id != static_cast<UINT>(-1) && id > 0 && CleanMenuText(GetMenuText(menu, index)) == name) {
			return static_cast<int>(id);
		}
	}

	for (int index = 0; index < count && index < 50; ++index) {
		const UINT id = GetMenuItemID(menu, index);
		const std::wstring clean = CleanMenuText(GetMenuText(menu, index));
		if (id != static_cast<UINT>(-1) && id > 0 && !clean.empty() &&
			(name.find(clean) != std::wstring::npos || clean.find(name) != std::wstring::npos)) {
			return static_cast<int>(id);
		}
	}

	for (int index = 0; index < count && index < 50; ++index) {
		const HMENU submenu = GetSubMenu(menu, index);
		if (submenu != nullptr) {
			const int found = MenuFindId(submenu, name, depth + 1);
			if (found >= 0) {
				return found;
			}
		}
	}
	return -1;
}

ReloadSendResult SendReloadIds(HWND hwnd, const std::vector<int>& reloadIds) {
	const ULONGLONG startedAt = GetTickCount64();
	for (int id : reloadIds) {
		if (!IsWindow(hwnd)) {
			return { false, id, ERROR_INVALID_WINDOW_HANDLE, GetTickCount64() - startedAt };
		}

		DWORD_PTR messageResult = 0;
		SetLastError(ERROR_SUCCESS);
		const LRESULT sent = SendMessageTimeoutW(
			hwnd,
			kWmCommand,
			static_cast<WPARAM>(id),
			0,
			SMTO_ABORTIFHUNG | SMTO_BLOCK,
			kReloadTimeoutMs,
			&messageResult);
		if (sent == 0) {
			DWORD error = GetLastError();
			if (error == ERROR_SUCCESS) error = ERROR_TIMEOUT;
			return { false, id, error, GetTickCount64() - startedAt };
		}
	}
	return { true, 0, ERROR_SUCCESS, GetTickCount64() - startedAt };
}

std::string FormatReloadFailure(const ReloadSendResult& sendResult) {
	if (sendResult.error == ERROR_TIMEOUT) {
		return u8"ERR:M2重载处理超时，菜单ID=" + std::to_string(sendResult.failedId) +
			u8"，已等待=" + std::to_string(sendResult.elapsedMs) + "ms";
	}
	return u8"ERR:M2重载命令失败，菜单ID=" + std::to_string(sendResult.failedId) +
		u8"，Win32=" + std::to_string(sendResult.error) +
		u8"，耗时=" + std::to_string(sendResult.elapsedMs) + "ms";
}

std::string DoReload(const std::vector<int>& reloadIds) {
	const HWND hwnd = FindMenuWindow();
	if (hwnd == nullptr) {
		return u8"ERR:未找到 M2Server 窗口，请确认服务端已启动";
	}
	const ReloadSendResult sendResult = SendReloadIds(hwnd, reloadIds);
	if (!sendResult.success) {
		return FormatReloadFailure(sendResult);
	}
	return "OK_PID=" + std::to_string(GetWindowProcessId(hwnd)) +
		" HWND=" + WindowHandleToString(hwnd) +
		" ELAPSED_MS=" + std::to_string(sendResult.elapsedMs);
}

std::string DoScanWindow(HWND hwnd) {
	if (hwnd == nullptr) {
		return u8"ERR:未找到 M2Server 窗口，请确认服务端已启动";
	}

	const HMENU menu = GetMenu(hwnd);
	const std::wstring title = GetWindowTitle(hwnd);
	const DWORD processId = GetWindowProcessId(hwnd);
	WriteStderr("Found menu window: PID=" + std::to_string(processId) +
		" HWND=" + WindowHandleToString(hwnd) +
		" Title='" + WideToUtf8(title) + "'");

	std::ostringstream output;
	output << "OK_PID=" << processId << " HWND=" << WindowHandleToString(hwnd) << '\n';
	const int menuCount = GetMenuItemCount(menu);
	for (int first = 0; first < menuCount && first < 20; ++first) {
		const std::wstring level1 = GetMenuText(menu, first);
		const HMENU submenu = GetSubMenu(menu, first);
		if (submenu != nullptr) {
			const int submenuCount = GetMenuItemCount(submenu);
			output << '[' << WideToUtf8(level1) << "] x" << submenuCount << '\n';
			for (int second = 0; second < submenuCount && second < 40; ++second) {
				const std::wstring level2 = GetMenuText(submenu, second);
				const HMENU submenu2 = GetSubMenu(submenu, second);
				if (submenu2 != nullptr) {
					const int submenu2Count = GetMenuItemCount(submenu2);
					output << "  [" << WideToUtf8(level2) << "] x" << submenu2Count << '\n';
					for (int third = 0; third < submenu2Count && third < 40; ++third) {
						output << "    " << WideToUtf8(GetMenuText(submenu2, third))
							<< " ID=" << static_cast<int>(GetMenuItemID(submenu2, third)) << '\n';
					}
				} else {
					output << "  " << WideToUtf8(level2)
						<< " ID=" << static_cast<int>(GetMenuItemID(submenu, second)) << '\n';
				}
			}
		} else {
			output << WideToUtf8(level1)
				<< " ID=" << static_cast<int>(GetMenuItemID(menu, first)) << '\n';
		}
	}
	return output.str();
}

std::string DoScan() {
	return DoScanWindow(FindMenuWindow());
}

std::string DoScanProcessId(DWORD processId) {
	if (!IsM2ProcessId(processId)) {
		return u8"ERR:指定 PID 不是正在运行的 M2Server.exe";
	}
	return DoScanWindow(FindMenuWindowForProcessId(processId));
}

std::string DoScanPath(const std::wstring& expectedPath) {
	const std::unordered_set<DWORD> matches = FindM2ProcessIdsForPath(expectedPath);
	if (matches.empty()) {
		return u8"ERR:未找到与指定路径完全匹配的 M2Server.exe";
	}
	return DoScanWindow(FindMenuWindowForProcessIds(matches));
}

std::string ReloadMenuNames(HWND hwnd, const std::string& requestedItems) {
	if (hwnd == nullptr) {
		return u8"ERR:未找到指定的 M2Server 窗口";
	}

	const HMENU menu = GetMenu(hwnd);
	std::vector<int> reloadIds;
	std::vector<std::string> notFound;
	for (const std::string& rawItem : Split(requestedItems, ',')) {
		const std::string item = TrimCopy(rawItem);
		int id = 0;
		if (TryParseInt(item, id)) {
			reloadIds.push_back(id);
			continue;
		}
		const int found = MenuFindId(menu, Utf8ToWide(item));
		if (found >= 0) {
			reloadIds.push_back(found);
		} else {
			notFound.push_back(item);
		}
	}

	if (!notFound.empty()) {
		WriteStderr(u8"[daemon] 未找到菜单项: " + JoinStrings(notFound, ", "));
	}
	if (reloadIds.empty()) {
		if (!notFound.empty()) {
			return u8"ERR:所有菜单项未找到: " + JoinStrings(notFound, ", ");
		}
		return u8"ERR:无有效重载项";
	}

	const ReloadSendResult sendResult = SendReloadIds(hwnd, reloadIds);
	if (!sendResult.success) {
		return FormatReloadFailure(sendResult);
	}
	const DWORD processId = GetWindowProcessId(hwnd);
	WriteStderr("[daemon] reload names=[" + requestedItems + "] IDs=[" +
		JoinInts(reloadIds) + "] pid=" + std::to_string(processId) +
		" hwnd=" + WindowHandleToString(hwnd) +
		" elapsed_ms=" + std::to_string(sendResult.elapsedMs));
	std::string result = "OK_PID=" + std::to_string(processId) +
		" HWND=" + WindowHandleToString(hwnd) +
		" ELAPSED_MS=" + std::to_string(sendResult.elapsedMs);
	if (!notFound.empty()) {
		result += u8" | 部分未找到: " + JoinStrings(notFound, ", ");
	}
	return result;
}

void RunDaemon() {
	WriteStderr("[daemon] started pid=" + std::to_string(GetCurrentProcessId()));
	std::string line;
	while (std::getline(std::cin, line)) {
		line = TrimCopy(line);
		if (line.empty()) {
			continue;
		}
		if (line == "exit") {
			break;
		}
		if (line == "ping") {
			WriteStdout("pong");
			continue;
		}
		if (line == "scan") {
			WriteStdout(DoScan());
			continue;
		}
		if (line.rfind("scanpid:", 0) == 0) {
			int processId = 0;
			if (!TryParseInt(line.substr(8), processId) || processId <= 0) {
				WriteStdout(u8"ERR:PID 无效");
			} else {
				WriteStdout(DoScanProcessId(static_cast<DWORD>(processId)));
			}
			continue;
		}
		if (line.rfind("scanpath:", 0) == 0) {
			const std::string expectedPath = TrimCopy(line.substr(9));
			if (expectedPath.empty()) {
				WriteStdout(u8"ERR:M2Server 路径为空");
			} else {
				WriteStdout(DoScanPath(Utf8ToWide(expectedPath)));
			}
			continue;
		}
		if (line.rfind("reloadpid:", 0) == 0) {
			const size_t separator = line.find('|', 10);
			int processId = 0;
			if (separator == std::string::npos ||
				!TryParseInt(line.substr(10, separator - 10), processId) ||
				processId <= 0) {
				WriteStdout(u8"ERR:reloadpid 命令格式无效");
			} else if (!IsM2ProcessId(static_cast<DWORD>(processId))) {
				WriteStdout(u8"ERR:指定 PID 不是正在运行的 M2Server.exe");
			} else {
				WriteStdout(ReloadMenuNames(
					FindMenuWindowForProcessId(static_cast<DWORD>(processId)),
					line.substr(separator + 1)));
			}
			continue;
		}
		if (line.rfind("reloadpath:", 0) == 0) {
			const size_t separator = line.find('|', 11);
			if (separator == std::string::npos) {
				WriteStdout(u8"ERR:reloadpath 命令格式无效");
			} else {
				const std::wstring expectedPath = Utf8ToWide(
					TrimCopy(line.substr(11, separator - 11)));
				WriteStdout(ReloadMenuNames(
					FindMenuWindowForPath(expectedPath),
					line.substr(separator + 1)));
			}
			continue;
		}
		if (line.rfind("reload:", 0) == 0) {
			WriteStdout(ReloadMenuNames(FindMenuWindow(), line.substr(7)));
			continue;
		}
		WriteStderr("[daemon] unknown: " + line);
	}
	WriteStderr("[daemon] exiting");
}

std::vector<int> ParseIds(int argc, wchar_t* argv[]) {
	std::vector<int> ids;
	if (argc > 2) {
		std::wstring value = argv[2];
		size_t start = 0;
		for (;;) {
			const size_t position = value.find(L',', start);
			const std::wstring item = position == std::wstring::npos
				? value.substr(start)
				: value.substr(start, position - start);
			int id = 0;
			if (TryParseWideInt(item, id)) {
				ids.push_back(id);
			}
			if (position == std::wstring::npos) {
				break;
			}
			start = position + 1;
		}
	}
	if (ids.empty()) {
		ids.push_back(20);
	}
	return ids;
}

} // namespace

int wmain(int argc, wchar_t* argv[]) {
	std::ios::sync_with_stdio(false);
	const std::wstring mode = argc > 1 ? argv[1] : L"scan";
	const std::vector<int> ids = ParseIds(argc, argv);

	if (mode == L"daemon") {
		RunDaemon();
		return 0;
	}

	if (mode == L"hwnd" && argc > 3) {
		HWND hwnd = nullptr;
		if (TryParseWindowHandle(argv[3], hwnd) && IsWindow(hwnd)) {
			const ReloadSendResult sendResult = SendReloadIds(hwnd, ids);
			WriteStdout(sendResult.success
				? "OK ELAPSED_MS=" + std::to_string(sendResult.elapsedMs)
				: FormatReloadFailure(sendResult));
		} else {
			WriteStdout("ERR:HWND_INVALID");
		}
		return 0;
	}

	if (mode == L"scan") {
		WriteStdout(DoScan());
		return 0;
	}
	if (mode == L"scanpid" && argc > 2) {
		int processId = 0;
		if (!TryParseWideInt(argv[2], processId) || processId <= 0) {
			WriteStdout(u8"ERR:PID 无效");
		} else {
			WriteStdout(DoScanProcessId(static_cast<DWORD>(processId)));
		}
		return 0;
	}
	if (mode == L"scanpath" && argc > 2) {
		WriteStdout(DoScanPath(argv[2]));
		return 0;
	}
	if (mode == L"reload") {
		WriteStdout(DoReload(ids));
		return 0;
	}

	WriteStdout(DoReload(ids));
	return 0;
}
