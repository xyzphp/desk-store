// 混合示例后端模块：演示 ABI 1 最小 WASI reactor 导出（_initialize + handle）。
package main

import (
	"encoding/base64"
	"encoding/json"
	"unsafe"
)

//go:wasmimport host request_len
func hostRequestLen() uint32

//go:wasmimport host request_read
func hostRequestRead(ptr, length uint32) int32

//go:wasmimport host response_write
func hostResponseWrite(ptr, length uint32) int32

//go:wasmexport handle
func handle() int32 {
	n := hostRequestLen()
	if n > 0 {
		buf := make([]byte, n)
		_ = hostRequestRead(uint32(uintptr(unsafe.Pointer(&buf[0]))), n)
	}
	body, _ := json.Marshal(map[string]any{"ok": true})
	resp, _ := json.Marshal(map[string]any{
		"status":   200,
		"headers":  map[string]string{"content-type": "application/json; charset=utf-8"},
		"body_b64": base64.StdEncoding.EncodeToString(body),
	})
	if hostResponseWrite(uint32(uintptr(unsafe.Pointer(&resp[0]))), uint32(len(resp))) < 0 {
		return 1
	}
	return 0
}

func main() {}
