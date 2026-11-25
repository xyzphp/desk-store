package appspec

import (
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"strconv"
	"strings"
)

// SignaturePrefix 是签名内容的版本标识；改变签名格式时必须同时改变它。
const SignaturePrefix = "desk-store-signature/v1"

// SignedRecord 是被签名的版本记录。
type SignedRecord struct {
	Store   string
	Slug    string
	Version string
	SHA256  string
	Format  int
}

// Payload 返回按行拼接的规范签名内容，避免依赖 JSON 序列化细节。
func (r SignedRecord) Payload() []byte {
	return []byte(strings.Join([]string{
		SignaturePrefix, r.Store, r.Slug, r.Version, strings.ToLower(r.SHA256), strconv.Itoa(r.Format),
	}, "\n") + "\n")
}

// Signature 是一条 Ed25519 签名。
type Signature struct {
	KeyID string `json:"keyId"`
	Value string `json:"value"`
}

// PublicKey 是商店公布的签名公钥。
type PublicKey struct {
	ID        string `json:"id"`
	Algorithm string `json:"algorithm"`
	Key       string `json:"key"`
}

// KeyID 由公钥派生：sha256 的前 16 个十六进制字符。
func KeyID(public ed25519.PublicKey) string {
	sum := sha256.Sum256(public)
	return hex.EncodeToString(sum[:])[:16]
}

// Fingerprint 返回供人工核对的公钥指纹（完整 sha256，每 4 位分组）。
func Fingerprint(public ed25519.PublicKey) string {
	sum := hex.EncodeToString(func() []byte { s := sha256.Sum256(public); return s[:] }())
	groups := make([]string, 0, len(sum)/4)
	for i := 0; i < len(sum); i += 4 {
		groups = append(groups, sum[i:i+4])
	}
	return strings.Join(groups, " ")
}

// ParsePrivateKey 读取 base64 编码的 32 字节种子。
func ParsePrivateKey(encoded string) (ed25519.PrivateKey, error) {
	seed, err := base64.StdEncoding.DecodeString(strings.TrimSpace(encoded))
	if err != nil || len(seed) != ed25519.SeedSize {
		return nil, errors.New("签名私钥必须是 base64 编码的 32 字节种子")
	}
	return ed25519.NewKeyFromSeed(seed), nil
}

// ParsePublicKey 读取商店公布的公钥并核对其 ID。
func ParsePublicKey(key PublicKey) (ed25519.PublicKey, error) {
	if key.Algorithm != "ed25519" {
		return nil, errors.New("只支持 ed25519 签名公钥")
	}
	raw, err := base64.StdEncoding.DecodeString(key.Key)
	if err != nil || len(raw) != ed25519.PublicKeySize {
		return nil, errors.New("签名公钥格式无效")
	}
	public := ed25519.PublicKey(raw)
	if KeyID(public) != key.ID {
		return nil, errors.New("签名公钥的 ID 与内容不一致")
	}
	return public, nil
}

// NewPublicKey 把公钥编码为商店公布的形式。
func NewPublicKey(public ed25519.PublicKey) PublicKey {
	return PublicKey{ID: KeyID(public), Algorithm: "ed25519", Key: base64.StdEncoding.EncodeToString(public)}
}

// Sign 用私钥签名版本记录。
func Sign(private ed25519.PrivateKey, record SignedRecord) Signature {
	public := private.Public().(ed25519.PublicKey)
	return Signature{KeyID: KeyID(public), Value: base64.StdEncoding.EncodeToString(ed25519.Sign(private, record.Payload()))}
}

// Verify 用商店公布的公钥列表校验签名。
func Verify(keys []PublicKey, record SignedRecord, signature Signature) error {
	for _, key := range keys {
		if key.ID != signature.KeyID {
			continue
		}
		public, err := ParsePublicKey(key)
		if err != nil {
			return err
		}
		value, err := base64.StdEncoding.DecodeString(signature.Value)
		if err != nil || !ed25519.Verify(public, record.Payload(), value) {
			return errors.New("签名校验失败")
		}
		return nil
	}
	return errors.New("签名使用的公钥不在商店公布的列表中")
}
