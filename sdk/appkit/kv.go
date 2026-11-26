package appkit

import "encoding/json"

// KVStore 提供对 host.kv_call 的类型安全封装。
type KVStore struct {
	scope string
}

// KV 返回指定存储范围（shared / public / account）的 KV 客户端。
func KV(scope string) *KVStore {
	return &KVStore{scope: scope}
}

type kvCallPayload struct {
	Scope  string          `json:"scope"`
	Op     string          `json:"op"`
	Key    string          `json:"key,omitempty"`
	Value  json.RawMessage `json:"value,omitempty"`
	Prefix string          `json:"prefix,omitempty"`
	Limit  int             `json:"limit,omitempty"`
}

func (k *KVStore) GetRaw(key string) (json.RawMessage, int64, bool, error) {
	raw, err := json.Marshal(kvCallPayload{Scope: k.scope, Op: "get", Key: key})
	if err != nil {
		return nil, 0, false, err
	}
	resp, err := abiKVCall(raw)
	if err != nil {
		return nil, 0, false, err
	}
	var out struct {
		Found     bool            `json:"found"`
		Value     json.RawMessage `json:"value"`
		UpdatedAt int64           `json:"updated_at"`
	}
	if err := json.Unmarshal(resp, &out); err != nil {
		return nil, 0, false, err
	}
	return out.Value, out.UpdatedAt, out.Found, nil
}

func (k *KVStore) Get(key string, dst any) (bool, error) {
	raw, _, found, err := k.GetRaw(key)
	if err != nil || !found {
		return found, err
	}
	if dst == nil {
		return true, nil
	}
	return true, json.Unmarshal(raw, dst)
}

func (k *KVStore) Set(key string, value any) (int64, error) {
	encoded, err := json.Marshal(value)
	if err != nil {
		return 0, err
	}
	raw, err := json.Marshal(kvCallPayload{Scope: k.scope, Op: "set", Key: key, Value: encoded})
	if err != nil {
		return 0, err
	}
	resp, err := abiKVCall(raw)
	if err != nil {
		return 0, err
	}
	var out struct {
		UpdatedAt int64 `json:"updated_at"`
	}
	if err := json.Unmarshal(resp, &out); err != nil {
		return 0, err
	}
	return out.UpdatedAt, nil
}

func (k *KVStore) Delete(key string) (bool, error) {
	raw, err := json.Marshal(kvCallPayload{Scope: k.scope, Op: "delete", Key: key})
	if err != nil {
		return false, err
	}
	resp, err := abiKVCall(raw)
	if err != nil {
		return false, err
	}
	var out struct {
		Deleted bool `json:"deleted"`
	}
	if err := json.Unmarshal(resp, &out); err != nil {
		return false, err
	}
	return out.Deleted, nil
}

func (k *KVStore) List(prefix string, limit int) ([]KVItem, bool, error) {
	raw, err := json.Marshal(kvCallPayload{Scope: k.scope, Op: "list", Prefix: prefix, Limit: limit})
	if err != nil {
		return nil, false, err
	}
	resp, err := abiKVCall(raw)
	if err != nil {
		return nil, false, err
	}
	var out struct {
		Items   []KVItem `json:"items"`
		HasMore bool     `json:"has_more"`
	}
	if err := json.Unmarshal(resp, &out); err != nil {
		return nil, false, err
	}
	return out.Items, out.HasMore, nil
}
