package appspec

import (
	"bytes"
	"strings"
	"testing"
)

func buildTestWasm(exports []struct {
	name string
	kind byte
	idx  byte
}, hostImports []string) []byte {
	var buf bytes.Buffer
	buf.Write([]byte{0x00, 'a', 's', 'm', 0x01, 0x00, 0x00, 0x00})
	// Type section:
	// 0: () -> ()
	// 1: () -> i32
	// 2: (i32, i32) -> i32
	typeSec := []byte{
		0x03,
		0x60, 0x00, 0x00,
		0x60, 0x00, 0x01, 0x7f,
		0x60, 0x02, 0x7f, 0x7f, 0x01, 0x7f,
	}
	writeSection(&buf, 1, typeSec)
	// Import section
	if len(hostImports) > 0 {
		var imp bytes.Buffer
		imp.WriteByte(byte(len(hostImports)))
		for _, fn := range hostImports {
			imp.WriteByte(byte(len("host")))
			imp.WriteString("host")
			imp.WriteByte(byte(len(fn)))
			imp.WriteString(fn)
			imp.WriteByte(0x00) // func
			if fn == "request_len" {
				imp.WriteByte(0x01)
			} else {
				imp.WriteByte(0x02)
			}
		}
		writeSection(&buf, 2, imp.Bytes())
	}
	// Function section: 2 defined funcs: _initialize (type 0), handle (type 1)
	writeSection(&buf, 3, []byte{0x02, 0x00, 0x01})
	// Memory section: 1 memory
	writeSection(&buf, 5, []byte{0x01, 0x00, 0x01})
	// Export section
	var exp bytes.Buffer
	exp.WriteByte(byte(len(exports)))
	for _, e := range exports {
		exp.WriteByte(byte(len(e.name)))
		exp.WriteString(e.name)
		exp.WriteByte(e.kind)
		exp.WriteByte(e.idx)
	}
	writeSection(&buf, 7, exp.Bytes())
	return buf.Bytes()
}

func writeSection(buf *bytes.Buffer, id byte, content []byte) {
	buf.WriteByte(id)
	buf.WriteByte(byte(len(content)))
	buf.Write(content)
}

func TestValidateBackendWasm(t *testing.T) {
	manifest := &Manifest{
		Format: 2,
		Backend: &Backend{
			Runtime: "wasm",
			ABI:     1,
			Module:  "backend/app.wasm",
			Storage: &BackendStorage{Shared: true},
		},
	}
	validExports := []struct {
		name string
		kind byte
		idx  byte
	}{
		{name: "memory", kind: 0x02, idx: 0},
		{name: "_initialize", kind: 0x00, idx: 2},
		{name: "handle", kind: 0x00, idx: 3},
	}
	wasm := buildTestWasm(validExports, []string{"request_len", "db_call"})
	if err := ValidateBackendWasm(wasm, manifest); err != nil {
		t.Fatalf("expected valid wasm, got %v", err)
	}
	// 导入未声明的 http_fetch 必须被拒绝
	badImport := buildTestWasm(validExports, []string{"request_len", "http_fetch"})
	if err := ValidateBackendWasm(badImport, manifest); err == nil || !strings.Contains(err.Error(), "http_fetch") {
		t.Fatalf("expected undeclared http_fetch error, got %v", err)
	}
	// 缺少 handle 导出必须被拒绝
	noHandle := buildTestWasm(validExports[:2], []string{"request_len", "db_call"})
	if err := ValidateBackendWasm(noHandle, manifest); err == nil || !strings.Contains(err.Error(), "handle") {
		t.Fatalf("expected missing handle error, got %v", err)
	}
}
