package appspec

import (
	"bytes"
	"crypto/ed25519"
	"crypto/rand"
	"strings"
	"testing"
)

const minimalManifest = `{"format":1,"slug":"demo-app","name":"演示","version":"1.2.0","description":"","entry":"index.html","icon":"icon.svg"}`

func minimalFiles() []File {
	return []File{{Path: "index.html", Content: []byte("<!doctype html>")}, {Path: "icon.svg", Content: []byte("<svg/>")}}
}

func TestParseManifestAcceptsMinimalPackage(t *testing.T) {
	manifest, err := ParseManifest([]byte(minimalManifest), minimalFiles())
	if err != nil {
		t.Fatalf("ParseManifest() error = %v", err)
	}
	if manifest.Slug != "demo-app" || len(manifest.Capabilities()) != 0 {
		t.Fatalf("unexpected manifest %+v", manifest)
	}
}

func TestParseManifestRejectsInvalidDeclarations(t *testing.T) {
	cases := map[string]string{
		"unknown field":   strings.Replace(minimalManifest, `"icon"`, `"homepage":"x","icon"`, 1),
		"reserved slug":   strings.Replace(minimalManifest, `"demo-app"`, `"api"`, 1),
		"data-app prefix": strings.Replace(minimalManifest, `"demo-app"`, `"data-app-x"`, 1),
		"bad version":     strings.Replace(minimalManifest, `"1.2.0"`, `"1.2"`, 1),
		"missing entry":   strings.Replace(minimalManifest, `"index.html"`, `"other.html"`, 1),
		"private auth": strings.Replace(minimalManifest, `"icon":"icon.svg"`,
			`"icon":"icon.svg","permissions":["proxy.svc"],"proxies":[{"key":"svc","title":"服务","upstream":"https://api.example.com","auth_type":"device_account","paths":["/"]}]`, 1),
		"permission without proxy": strings.Replace(minimalManifest, `"icon":"icon.svg"`, `"icon":"icon.svg","permissions":["proxy.svc"]`, 1),
		"gateway api namespace":    strings.Replace(minimalManifest, `"icon":"icon.svg"`, `"icon":"icon.svg","gateway_api":["/other/"]`, 1),
	}
	for name, raw := range cases {
		if _, err := ParseManifest([]byte(raw), minimalFiles()); err == nil {
			t.Errorf("%s: expected an error", name)
		}
	}
}

func TestWindowMinimumSize(t *testing.T) {
	withWindow := func(window string) string {
		return strings.Replace(minimalManifest, `"icon":"icon.svg"`, `"icon":"icon.svg","window":`+window, 1)
	}
	manifest, err := ParseManifest([]byte(withWindow(`{"width":1400,"height":800,"min_width":1400,"min_height":600}`)), minimalFiles())
	if err != nil {
		t.Fatal(err)
	}
	if got := strings.Join(manifest.Capabilities(), ","); got != "window,window.min_size" {
		t.Fatalf("capabilities = %s", got)
	}
	if manifest, err = ParseManifest([]byte(withWindow(`{"width":900,"height":620}`)), minimalFiles()); err != nil || strings.Join(manifest.Capabilities(), ",") != "window" {
		t.Fatalf("plain window: %v %v", manifest, err)
	}
	for _, window := range []string{
		`{"width":900,"height":620,"min_width":1000}`,
		`{"width":900,"height":620,"min_width":200}`,
		`{"width":900,"height":620,"min_height":700}`,
		`{"width":900,"height":620,"min_height":100}`,
	} {
		if _, err := ParseManifest([]byte(withWindow(window)), minimalFiles()); err == nil {
			t.Errorf("invalid window accepted: %s", window)
		}
	}
}

func TestPackIsDeterministicAndRoundTrips(t *testing.T) {
	pkg := &Package{ManifestRaw: []byte(minimalManifest), Files: minimalFiles()}
	first, err := pkg.Pack()
	if err != nil {
		t.Fatalf("Pack() error = %v", err)
	}
	reversed := &Package{ManifestRaw: []byte(minimalManifest), Files: []File{minimalFiles()[1], minimalFiles()[0]}}
	second, err := reversed.Pack()
	if err != nil {
		t.Fatalf("Pack() error = %v", err)
	}
	if !bytes.Equal(first, second) {
		t.Fatal("packing the same content in a different order changed the bytes")
	}
	parsed, err := ParseZip(first)
	if err != nil {
		t.Fatalf("ParseZip() error = %v", err)
	}
	if parsed.Manifest.Version != "1.2.0" || len(parsed.Files) != 2 {
		t.Fatalf("unexpected round trip %+v", parsed.Manifest)
	}
}

func TestSignatureVerification(t *testing.T) {
	public, private, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	keys := []PublicKey{NewPublicKey(public)}
	record := SignedRecord{Store: "store", Slug: "demo-app", Version: "1.0.0", SHA256: strings.Repeat("a", 64), Format: 1}
	signature := Sign(private, record)
	if err := Verify(keys, record, signature); err != nil {
		t.Fatalf("Verify() error = %v", err)
	}
	tampered := record
	tampered.SHA256 = strings.Repeat("b", 64)
	if Verify(keys, tampered, signature) == nil {
		t.Fatal("a changed hash must not verify")
	}
	otherStore := record
	otherStore.Store = "other"
	if Verify(keys, otherStore, signature) == nil {
		t.Fatal("a record from another store must not verify")
	}
	if Verify(nil, record, signature) == nil {
		t.Fatal("an unknown key must not verify")
	}
}

func TestCompareVersions(t *testing.T) {
	ordered := []string{"0.9.0", "1.0.0-alpha", "1.0.0-alpha.2", "1.0.0-beta", "1.0.0", "1.0.1", "1.10.0", "2.0.0"}
	for i := 1; i < len(ordered); i++ {
		if CompareVersions(ordered[i-1], ordered[i]) >= 0 {
			t.Errorf("%s should be lower than %s", ordered[i-1], ordered[i])
		}
	}
	if CompareVersions("1.0.0+build.1", "1.0.0") != 0 {
		t.Error("build metadata must not affect ordering")
	}
}

func TestDiffReportsExpandedPermissions(t *testing.T) {
	before := Summary{Entry: "entry", Proxies: []ProxySummary{{Key: "svc", Upstream: "https://a.example.com", Methods: []string{"GET"}, Paths: []string{"/v1"}}}}
	after := Summary{Entry: "entry", GatewayAPI: []string{"/xyzos/api/files/"},
		Proxies: []ProxySummary{{Key: "svc", Upstream: "https://b.example.com", Methods: []string{"GET", "POST"}, Paths: []string{"/v1"}}}}
	changes := strings.Join(Diff(before, after), "\n")
	for _, want := range []string{"/xyzos/api/files/", "https://b.example.com", "POST"} {
		if !strings.Contains(changes, want) {
			t.Errorf("diff %q should mention %s", changes, want)
		}
	}
}
