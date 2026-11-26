package appspec

import (
	"bytes"
	"encoding/binary"
	"errors"
	"fmt"
	"io"
)

// ValidateBackendWasm 静态解析 WebAssembly 二进制段（Type / Import / Function / Export），
// 校验 ABI 1 模块导出（memory、_initialize、handle，可选 migrate）与 host.* 导入白名单是否与清单一致。
func ValidateBackendWasm(wasm []byte, manifest *Manifest) error {
	if manifest == nil || manifest.Backend == nil {
		return nil
	}
	if len(wasm) < 8 || !bytes.Equal(wasm[:4], []byte{0x00, 'a', 's', 'm'}) {
		return errors.New("后端模块不是有效的 WebAssembly 文件")
	}
	if version := binary.LittleEndian.Uint32(wasm[4:8]); version != 1 {
		return fmt.Errorf("后端模块 WebAssembly 版本不支持：%d", version)
	}
	parsed, err := parseWasmSections(wasm[8:])
	if err != nil {
		return fmt.Errorf("解析后端模块失败：%w", err)
	}
	if !parsed.exportedMemories["memory"] {
		return errors.New("后端模块必须导出 memory")
	}
	initSig, ok := parsed.exportedFuncSig("_initialize")
	if !ok || len(initSig.params) != 0 || len(initSig.results) != 0 {
		return errors.New("后端模块必须以 WASI reactor 模式构建并导出 _initialize()（Go 请使用 -buildmode=c-shared）")
	}
	handleSig, ok := parsed.exportedFuncSig("handle")
	if !ok || len(handleSig.params) != 0 || len(handleSig.results) != 1 || handleSig.results[0] != wasmValI32 {
		return errors.New("后端模块必须导出 handle() -> i32 入口函数")
	}
	if migSig, hasMig := parsed.exportedFuncSig("migrate"); hasMig {
		if len(migSig.params) != 0 || len(migSig.results) != 1 || migSig.results[0] != wasmValI32 {
			return errors.New("后端模块导出的 migrate 必须为 migrate() -> i32 签名")
		}
	}
	for _, imp := range parsed.imports {
		if imp.kind != wasmExternFunc {
			return fmt.Errorf("后端模块不允许导入非函数项 %s.%s", imp.module, imp.name)
		}
		switch imp.module {
		case "wasi_snapshot_preview1":
			continue
		case "host":
			spec, known := abi1HostFuncSpecs[imp.name]
			if !known {
				return fmt.Errorf("后端模块导入了未知的宿主函数 host.%s", imp.name)
			}
			if imp.typeIndex >= uint32(len(parsed.types)) {
				return fmt.Errorf("后端模块导入函数 host.%s 的类型索引无效", imp.name)
			}
			sig := parsed.types[imp.typeIndex]
			if !bytes.Equal(sig.params, spec.params) || !bytes.Equal(sig.results, spec.results) {
				return fmt.Errorf("后端模块导入的 host.%s 签名与 ABI 1 不一致", imp.name)
			}
			if !spec.allowed(manifest) {
				return fmt.Errorf("后端模块导入了清单未声明的能力函数 host.%s", imp.name)
			}
		default:
			return fmt.Errorf("后端模块导入了不允许的模块 %q", imp.module)
		}
	}
	return nil
}

const (
	wasmValI32     byte = 0x7f
	wasmExternFunc byte = 0x00
	wasmExternMem  byte = 0x02
)

type wasmFuncSig struct {
	params  []byte
	results []byte
}

type abi1HostFuncSpec struct {
	params  []byte
	results []byte
	allowed func(*Manifest) bool
}

var abi1HostFuncSpecs = map[string]abi1HostFuncSpec{
	"request_len": {
		params: nil, results: []byte{wasmValI32},
		allowed: func(*Manifest) bool { return true },
	},
	"request_read": {
		params: []byte{wasmValI32, wasmValI32}, results: []byte{wasmValI32},
		allowed: func(*Manifest) bool { return true },
	},
	"response_write": {
		params: []byte{wasmValI32, wasmValI32}, results: []byte{wasmValI32},
		allowed: func(*Manifest) bool { return true },
	},
	"result_read": {
		params: []byte{wasmValI32, wasmValI32}, results: []byte{wasmValI32},
		allowed: func(*Manifest) bool { return true },
	},
	"log": {
		params: []byte{wasmValI32, wasmValI32, wasmValI32}, results: []byte{wasmValI32},
		allowed: func(*Manifest) bool { return true },
	},
	"config_get": {
		params: []byte{wasmValI32, wasmValI32}, results: []byte{wasmValI32},
		allowed: func(m *Manifest) bool { return m.Backend != nil && len(m.Backend.Config) > 0 },
	},
	"db_call": {
		params: []byte{wasmValI32, wasmValI32}, results: []byte{wasmValI32},
		allowed: func(m *Manifest) bool { return m.Backend != nil && len(m.Backend.StorageScopes()) > 0 },
	},
	"kv_call": {
		params: []byte{wasmValI32, wasmValI32}, results: []byte{wasmValI32},
		allowed: func(m *Manifest) bool { return m.Backend != nil && len(m.Backend.StorageScopes()) > 0 },
	},
	"http_fetch": {
		params: []byte{wasmValI32, wasmValI32}, results: []byte{wasmValI32},
		allowed: func(m *Manifest) bool {
			return m.Backend != nil && m.Backend.HTTP != nil && len(m.Backend.HTTP.Allow) > 0
		},
	},
	"proxy_fetch": {
		params: []byte{wasmValI32, wasmValI32}, results: []byte{wasmValI32},
		allowed: func(m *Manifest) bool { return len(m.Proxies) > 0 },
	},
	"api_call": {
		params: []byte{wasmValI32, wasmValI32}, results: []byte{wasmValI32},
		allowed: func(m *Manifest) bool { return len(m.GatewayAPI) > 0 },
	},
	"platform_call": {
		params: []byte{wasmValI32, wasmValI32}, results: []byte{wasmValI32},
		allowed: func(m *Manifest) bool {
			if m.Platform == nil {
				return false
			}
			_, hasSettings := m.Platform.Provides["settings"]
			return len(m.Platform.Uses) > 0 || hasSettings
		},
	},
}

type wasmImport struct {
	module    string
	name      string
	kind      byte
	typeIndex uint32
}

type wasmModuleInfo struct {
	types            []wasmFuncSig
	imports          []wasmImport
	importFuncTypes  []uint32
	definedFuncTypes []uint32
	exportedFuncs    map[string]uint32
	exportedMemories map[string]bool
}

func (m *wasmModuleInfo) exportedFuncSig(name string) (wasmFuncSig, bool) {
	idx, ok := m.exportedFuncs[name]
	if !ok {
		return wasmFuncSig{}, false
	}
	var typeIdx uint32
	if int(idx) < len(m.importFuncTypes) {
		typeIdx = m.importFuncTypes[idx]
	} else {
		defIdx := int(idx) - len(m.importFuncTypes)
		if defIdx < 0 || defIdx >= len(m.definedFuncTypes) {
			return wasmFuncSig{}, false
		}
		typeIdx = m.definedFuncTypes[defIdx]
	}
	if int(typeIdx) >= len(m.types) {
		return wasmFuncSig{}, false
	}
	return m.types[typeIdx], true
}

func parseWasmSections(data []byte) (*wasmModuleInfo, error) {
	r := bytes.NewReader(data)
	info := &wasmModuleInfo{
		exportedFuncs:    map[string]uint32{},
		exportedMemories: map[string]bool{},
	}
	for r.Len() > 0 {
		secID, err := r.ReadByte()
		if err != nil {
			return nil, err
		}
		secLen, err := readULEB32(r)
		if err != nil {
			return nil, err
		}
		if int(secLen) > r.Len() {
			return nil, io.ErrUnexpectedEOF
		}
		secBuf := make([]byte, secLen)
		if _, err := io.ReadFull(r, secBuf); err != nil {
			return nil, err
		}
		sr := bytes.NewReader(secBuf)
		switch secID {
		case 1: // Type section
			count, err := readULEB32(sr)
			if err != nil {
				return nil, err
			}
			for i := uint32(0); i < count; i++ {
				form, err := sr.ReadByte()
				if err != nil || form != 0x60 {
					return nil, errors.New("不支持的类型段条目")
				}
				params, err := readByteVec(sr)
				if err != nil {
					return nil, err
				}
				results, err := readByteVec(sr)
				if err != nil {
					return nil, err
				}
				info.types = append(info.types, wasmFuncSig{params: params, results: results})
			}
		case 2: // Import section
			count, err := readULEB32(sr)
			if err != nil {
				return nil, err
			}
			for i := uint32(0); i < count; i++ {
				modName, err := readWasmString(sr)
				if err != nil {
					return nil, err
				}
				fieldName, err := readWasmString(sr)
				if err != nil {
					return nil, err
				}
				kind, err := sr.ReadByte()
				if err != nil {
					return nil, err
				}
				imp := wasmImport{module: modName, name: fieldName, kind: kind}
				switch kind {
				case wasmExternFunc:
					typeIdx, err := readULEB32(sr)
					if err != nil {
						return nil, err
					}
					imp.typeIndex = typeIdx
					info.importFuncTypes = append(info.importFuncTypes, typeIdx)
				case 0x01: // table
					if _, err := sr.ReadByte(); err != nil {
						return nil, err
					}
					if err := skipLimits(sr); err != nil {
						return nil, err
					}
				case wasmExternMem:
					if err := skipLimits(sr); err != nil {
						return nil, err
					}
				case 0x03: // global
					if _, err := sr.ReadByte(); err != nil {
						return nil, err
					}
					if _, err := sr.ReadByte(); err != nil {
						return nil, err
					}
				default:
					return nil, fmt.Errorf("未知导入类型 %d", kind)
				}
				info.imports = append(info.imports, imp)
			}
		case 3: // Function section
			count, err := readULEB32(sr)
			if err != nil {
				return nil, err
			}
			for i := uint32(0); i < count; i++ {
				typeIdx, err := readULEB32(sr)
				if err != nil {
					return nil, err
				}
				info.definedFuncTypes = append(info.definedFuncTypes, typeIdx)
			}
		case 7: // Export section
			count, err := readULEB32(sr)
			if err != nil {
				return nil, err
			}
			for i := uint32(0); i < count; i++ {
				name, err := readWasmString(sr)
				if err != nil {
					return nil, err
				}
				kind, err := sr.ReadByte()
				if err != nil {
					return nil, err
				}
				idx, err := readULEB32(sr)
				if err != nil {
					return nil, err
				}
				if kind == wasmExternFunc {
					info.exportedFuncs[name] = idx
				} else if kind == wasmExternMem {
					info.exportedMemories[name] = true
				}
			}
		}
	}
	return info, nil
}

func readULEB32(r *bytes.Reader) (uint32, error) {
	var result uint32
	var shift uint
	for i := 0; i < 5; i++ {
		b, err := r.ReadByte()
		if err != nil {
			return 0, err
		}
		result |= uint32(b&0x7f) << shift
		if b&0x80 == 0 {
			return result, nil
		}
		shift += 7
	}
	return 0, errors.New("ULEB128 编码溢出")
}

func readByteVec(r *bytes.Reader) ([]byte, error) {
	n, err := readULEB32(r)
	if err != nil {
		return nil, err
	}
	if int(n) > r.Len() {
		return nil, io.ErrUnexpectedEOF
	}
	buf := make([]byte, n)
	if _, err := io.ReadFull(r, buf); err != nil {
		return nil, err
	}
	return buf, nil
}

func readWasmString(r *bytes.Reader) (string, error) {
	b, err := readByteVec(r)
	if err != nil {
		return "", err
	}
	return string(b), nil
}

func skipLimits(r *bytes.Reader) error {
	flags, err := r.ReadByte()
	if err != nil {
		return err
	}
	if _, err := readULEB32(r); err != nil {
		return err
	}
	if flags&0x01 != 0 {
		if _, err := readULEB32(r); err != nil {
			return err
		}
	}
	return nil
}
