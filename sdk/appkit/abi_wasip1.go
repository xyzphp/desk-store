//go:build wasip1 && wasm

package appkit

import "unsafe"

// 每个宿主能力均作为独立函数绑定 //go:wasmimport，避免集中登记表阻止 Go 编译器裁剪未使用的导入。
// 若应用未调用某项能力（如 http_fetch），编译出的 Wasm 不会产生该导入项，从而通过清单能力核对。

//go:wasmimport host request_len
func wasmRequestLen() uint32

//go:wasmimport host request_read
func wasmRequestRead(ptr, length uint32) int32

//go:wasmimport host response_write
func wasmResponseWrite(ptr, length uint32) int32

//go:wasmimport host result_read
func wasmResultRead(ptr, length uint32) int32

//go:wasmimport host log
func wasmLog(level, ptr, length uint32) int32

//go:wasmimport host config_get
func wasmConfigGet(ptr, length uint32) int32

//go:wasmimport host db_call
func wasmDBCall(ptr, length uint32) int32

//go:wasmimport host kv_call
func wasmKVCall(ptr, length uint32) int32

//go:wasmimport host http_fetch
func wasmHTTPFetch(ptr, length uint32) int32

//go:wasmimport host proxy_fetch
func wasmProxyFetch(ptr, length uint32) int32

//go:wasmimport host api_call
func wasmAPICall(ptr, length uint32) int32

//go:wasmimport host platform_call
func wasmPlatformCall(ptr, length uint32) int32

func bytesPtrLen(data []byte) (uint32, uint32) {
	if len(data) == 0 {
		return 0, 0
	}
	return uint32(uintptr(unsafe.Pointer(&data[0]))), uint32(len(data))
}

func readResultBuffer(size int32) []byte {
	if size <= 0 {
		n := wasmResultRead(0, 0)
		if n <= 0 {
			return nil
		}
		buf := make([]byte, n)
		got := wasmResultRead(uint32(uintptr(unsafe.Pointer(&buf[0]))), uint32(n))
		if got <= 0 {
			return nil
		}
		return buf[:got]
	}
	buf := make([]byte, size)
	got := wasmResultRead(uint32(uintptr(unsafe.Pointer(&buf[0]))), uint32(size))
	if got <= 0 {
		return nil
	}
	return buf[:got]
}

func abiReadRequest() ([]byte, error) {
	n := wasmRequestLen()
	if n == 0 {
		return nil, &HostError{Op: "request_read", Code: CodeInvalid, Message: "empty request envelope"}
	}
	buf := make([]byte, n)
	got := wasmRequestRead(uint32(uintptr(unsafe.Pointer(&buf[0]))), n)
	if got < 0 {
		return nil, &HostError{Op: "request_read", Code: got, Message: string(readResultBuffer(0))}
	}
	return buf[:got], nil
}

func abiWriteResponse(data []byte) error {
	ptr, length := bytesPtrLen(data)
	code := wasmResponseWrite(ptr, length)
	if code < 0 {
		return &HostError{Op: "response_write", Code: code, Message: string(readResultBuffer(0))}
	}
	return nil
}

func abiLog(level uint32, msg []byte) error {
	ptr, length := bytesPtrLen(msg)
	code := wasmLog(level, ptr, length)
	if code < 0 {
		return &HostError{Op: "log", Code: code, Message: string(readResultBuffer(0))}
	}
	return nil
}

func abiConfigGet(key []byte) ([]byte, error) {
	ptr, length := bytesPtrLen(key)
	n := wasmConfigGet(ptr, length)
	if n < 0 {
		return nil, &HostError{Op: "config_get", Code: n, Message: string(readResultBuffer(0))}
	}
	if n == 0 {
		return nil, nil
	}
	return readResultBuffer(n), nil
}

func abiDBCall(payload []byte) ([]byte, error) {
	ptr, length := bytesPtrLen(payload)
	n := wasmDBCall(ptr, length)
	if n < 0 {
		return nil, &HostError{Op: "db_call", Code: n, Message: string(readResultBuffer(0))}
	}
	if n == 0 {
		return nil, nil
	}
	return readResultBuffer(n), nil
}

func abiKVCall(payload []byte) ([]byte, error) {
	ptr, length := bytesPtrLen(payload)
	n := wasmKVCall(ptr, length)
	if n < 0 {
		return nil, &HostError{Op: "kv_call", Code: n, Message: string(readResultBuffer(0))}
	}
	if n == 0 {
		return nil, nil
	}
	return readResultBuffer(n), nil
}

func abiHTTPFetch(payload []byte) ([]byte, error) {
	ptr, length := bytesPtrLen(payload)
	n := wasmHTTPFetch(ptr, length)
	if n < 0 {
		return nil, &HostError{Op: "http_fetch", Code: n, Message: string(readResultBuffer(0))}
	}
	if n == 0 {
		return nil, nil
	}
	return readResultBuffer(n), nil
}

func abiProxyFetch(payload []byte) ([]byte, error) {
	ptr, length := bytesPtrLen(payload)
	n := wasmProxyFetch(ptr, length)
	if n < 0 {
		return nil, &HostError{Op: "proxy_fetch", Code: n, Message: string(readResultBuffer(0))}
	}
	if n == 0 {
		return nil, nil
	}
	return readResultBuffer(n), nil
}

func abiAPICall(payload []byte) ([]byte, error) {
	ptr, length := bytesPtrLen(payload)
	n := wasmAPICall(ptr, length)
	if n < 0 {
		return nil, &HostError{Op: "api_call", Code: n, Message: string(readResultBuffer(0))}
	}
	if n == 0 {
		return nil, nil
	}
	return readResultBuffer(n), nil
}

func abiPlatformCall(payload []byte) ([]byte, error) {
	ptr, length := bytesPtrLen(payload)
	n := wasmPlatformCall(ptr, length)
	if n < 0 {
		return nil, &HostError{Op: "platform_call", Code: n, Message: string(readResultBuffer(0))}
	}
	if n == 0 {
		return nil, nil
	}
	return readResultBuffer(n), nil
}
