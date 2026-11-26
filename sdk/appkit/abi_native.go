//go:build !(wasip1 && wasm)

package appkit

import "sync"

// HostAdapter 定义本机测试环境下（非 wasip1/wasm 构建）的宿主模拟器接口，由 sdk/apphost 实现。
type HostAdapter interface {
	ReadRequest() ([]byte, error)
	WriteResponse(data []byte) error
	Log(level uint32, msg []byte) error
	ConfigGet(key []byte) ([]byte, error)
	DBCall(payload []byte) ([]byte, error)
	KVCall(payload []byte) ([]byte, error)
	HTTPFetch(payload []byte) ([]byte, error)
	ProxyFetch(payload []byte) ([]byte, error)
	APICall(payload []byte) ([]byte, error)
	PlatformCall(payload []byte) ([]byte, error)
}

var (
	nativeHostMu sync.RWMutex
	nativeHost   HostAdapter
)

// SetHostAdapter 替换当前进程的宿主适配器（仅用于本机 go test），返回恢复函数。
func SetHostAdapter(adapter HostAdapter) func() {
	nativeHostMu.Lock()
	prev := nativeHost
	nativeHost = adapter
	nativeHostMu.Unlock()
	return func() {
		nativeHostMu.Lock()
		nativeHost = prev
		nativeHostMu.Unlock()
	}
}

func currentHost(op string) (HostAdapter, error) {
	nativeHostMu.RLock()
	h := nativeHost
	nativeHostMu.RUnlock()
	if h == nil {
		return nil, &HostError{Op: op, Code: CodeErr, Message: "no native host adapter configured (use sdk/apphost in tests)"}
	}
	return h, nil
}

func abiReadRequest() ([]byte, error) {
	h, err := currentHost("request_read")
	if err != nil {
		return nil, err
	}
	return h.ReadRequest()
}

func abiWriteResponse(data []byte) error {
	h, err := currentHost("response_write")
	if err != nil {
		return err
	}
	return h.WriteResponse(data)
}

func abiLog(level uint32, msg []byte) error {
	h, err := currentHost("log")
	if err != nil {
		return err
	}
	return h.Log(level, msg)
}

func abiConfigGet(key []byte) ([]byte, error) {
	h, err := currentHost("config_get")
	if err != nil {
		return nil, err
	}
	return h.ConfigGet(key)
}

func abiDBCall(payload []byte) ([]byte, error) {
	h, err := currentHost("db_call")
	if err != nil {
		return nil, err
	}
	return h.DBCall(payload)
}

func abiKVCall(payload []byte) ([]byte, error) {
	h, err := currentHost("kv_call")
	if err != nil {
		return nil, err
	}
	return h.KVCall(payload)
}

func abiHTTPFetch(payload []byte) ([]byte, error) {
	h, err := currentHost("http_fetch")
	if err != nil {
		return nil, err
	}
	return h.HTTPFetch(payload)
}

func abiProxyFetch(payload []byte) ([]byte, error) {
	h, err := currentHost("proxy_fetch")
	if err != nil {
		return nil, err
	}
	return h.ProxyFetch(payload)
}

func abiAPICall(payload []byte) ([]byte, error) {
	h, err := currentHost("api_call")
	if err != nil {
		return nil, err
	}
	return h.APICall(payload)
}

func abiPlatformCall(payload []byte) ([]byte, error) {
	h, err := currentHost("platform_call")
	if err != nil {
		return nil, err
	}
	return h.PlatformCall(payload)
}
