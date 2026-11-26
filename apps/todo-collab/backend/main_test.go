package main

import (
	"encoding/base64"
	"encoding/json"
	"net/http"
	"testing"

	"github.com/xyzphp/desk-store/sdk/apphost"
	"github.com/xyzphp/desk-store/sdk/appkit"
)

func decodeJSONBody(t *testing.T, resp appkit.ResponseEnvelope) map[string]any {
	t.Helper()
	raw, err := base64.StdEncoding.DecodeString(resp.BodyB64)
	if err != nil {
		t.Fatalf("decode body: %v", err)
	}
	var out map[string]any
	if err := json.Unmarshal(raw, &out); err != nil {
		t.Fatalf("unmarshal body: %v (%s)", err, string(raw))
	}
	return out
}

func TestTodoCollabSharedAndAccountIsolation(t *testing.T) {
	host, err := apphost.NewFromAppDir("..",
		apphost.WithSettings(map[string]any{"default_priority": "high"}),
		apphost.WithAuthorizedUsers(1, 2),
	)
	if err != nil {
		t.Fatalf("NewFromAppDir: %v", err)
	}
	defer host.Close()

	if err := host.RunMigrate("1.0.0", "1.1.0", runMigrate); err != nil {
		t.Fatalf("RunMigrate: %v", err)
	}

	router := buildRouter()
	alice := appkit.RequestContext{
		User:        &appkit.User{ID: 1, DisplayName: "Alice"},
		Permissions: []string{"task.write", "board.manage"},
	}
	bob := appkit.RequestContext{
		User:        &appkit.User{ID: 2, DisplayName: "Bob"},
		Permissions: []string{},
	}

	// Bob 没有 task.write 权限，新增任务必须返回 403
	taskBody, _ := json.Marshal(map[string]any{"board_id": 1, "title": "越权任务"})
	denied, err := host.Do(appkit.RequestEnvelope{
		Method:  http.MethodPost,
		Path:    "/tasks",
		BodyB64: base64.StdEncoding.EncodeToString(taskBody),
		Context: bob,
	}, router)
	if err != nil || denied.Status != http.StatusForbidden {
		t.Fatalf("expected 403 for bob, got status=%d err=%v", denied.Status, err)
	}

	// Alice 新增共享任务，不填优先级时沿用设置中的 default_priority=high
	createBody, _ := json.Marshal(map[string]any{"board_id": 1, "title": "准备发布清单"})
	created, err := host.Do(appkit.RequestEnvelope{
		Method:  http.MethodPost,
		Path:    "/tasks",
		BodyB64: base64.StdEncoding.EncodeToString(createBody),
		Context: alice,
	}, router)
	if err != nil || created.Status != http.StatusCreated {
		t.Fatalf("create task failed: status=%d err=%v", created.Status, err)
	}
	taskObj := decodeJSONBody(t, created)["task"].(map[string]any)
	if taskObj["priority"] != "high" {
		t.Fatalf("expected default priority high, got %v", taskObj["priority"])
	}

	// Alice 置顶任务 1 并设置个人筛选为 pinned
	pinResp, err := host.Do(appkit.RequestEnvelope{Method: http.MethodPost, Path: "/me/pins/1", Context: alice}, router)
	if err != nil || pinResp.Status != http.StatusOK {
		t.Fatalf("alice pin: status=%d err=%v", pinResp.Status, err)
	}
	filterBody, _ := json.Marshal(map[string]string{"filter": "pinned"})
	if _, err := host.Do(appkit.RequestEnvelope{
		Method:  http.MethodPut,
		Path:    "/me/filter",
		BodyB64: base64.StdEncoding.EncodeToString(filterBody),
		Context: alice,
	}, router); err != nil {
		t.Fatalf("alice filter: %v", err)
	}

	// Bob 读取状态：能看到共享任务 1，但个人置顶与筛选与 Alice 完全隔离
	bobState, err := host.Do(appkit.RequestEnvelope{Method: http.MethodGet, Path: "/state", Context: bob}, router)
	if err != nil || bobState.Status != http.StatusOK {
		t.Fatalf("bob state: status=%d err=%v", bobState.Status, err)
	}
	bobData := decodeJSONBody(t, bobState)
	if len(bobData["tasks"].([]any)) != 1 {
		t.Fatalf("bob should see 1 shared task, got %v", bobData["tasks"])
	}
	if len(bobData["pinned_ids"].([]any)) != 0 || bobData["filter"] != "all" {
		t.Fatalf("bob account storage must be isolated from alice: pins=%v filter=%v", bobData["pinned_ids"], bobData["filter"])
	}

	// Bob 触发站内提醒
	remResp, err := host.Do(appkit.RequestEnvelope{Method: http.MethodPost, Path: "/remind/1", Context: bob}, router)
	if err != nil || remResp.Status != http.StatusOK {
		t.Fatalf("remind: status=%d err=%v", remResp.Status, err)
	}
	if len(host.Notifications()) != 1 || host.Notifications()[0].UserID != 2 {
		t.Fatalf("expected notification for bob (2), got %+v", host.Notifications())
	}
}
