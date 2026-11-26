package main

import (
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/xyzphp/desk-store/sdk/appkit"
)

type boardItem struct {
	ID        int64  `json:"id"`
	Title     string `json:"title"`
	CreatedBy int64  `json:"created_by"`
	CreatedAt int64  `json:"created_at"`
}

type taskItem struct {
	ID            int64  `json:"id"`
	BoardID       int64  `json:"board_id"`
	Title         string `json:"title"`
	Status        string `json:"status"`
	Priority      string `json:"priority"`
	CreatedBy     int64  `json:"created_by"`
	CreatedByName string `json:"created_by_name"`
	CreatedAt     int64  `json:"created_at"`
}

func validPriority(value string) bool {
	return value == "low" || value == "normal" || value == "high"
}

func defaultPrioritySetting() string {
	var cfg struct {
		DefaultPriority string `json:"default_priority"`
	}
	if _, err := appkit.SettingsGet(&cfg); err == nil && validPriority(cfg.DefaultPriority) {
		return cfg.DefaultPriority
	}
	return "normal"
}

func buildRouter() *appkit.Router {
	r := appkit.NewRouter()

	r.Get("/state", func(c *appkit.Context) {
		sharedDB := appkit.OpenDB("shared")
		boards := []boardItem{}
		bRows, err := sharedDB.Query(`SELECT id, title, created_by, created_at FROM boards ORDER BY id ASC`)
		if err != nil {
			c.Error(http.StatusInternalServerError, "读取看板失败")
			return
		}
		for bRows.Next() {
			var b boardItem
			if err := bRows.Scan(&b.ID, &b.Title, &b.CreatedBy, &b.CreatedAt); err == nil {
				boards = append(boards, b)
			}
		}
		_ = bRows.Close()

		tasks := []taskItem{}
		tRows, err := sharedDB.Query(`SELECT id, board_id, title, status, priority, created_by, created_by_name, created_at FROM tasks ORDER BY id DESC`)
		if err != nil {
			c.Error(http.StatusInternalServerError, "读取任务失败")
			return
		}
		for tRows.Next() {
			var t taskItem
			if err := tRows.Scan(&t.ID, &t.BoardID, &t.Title, &t.Status, &t.Priority, &t.CreatedBy, &t.CreatedByName, &t.CreatedAt); err == nil {
				tasks = append(tasks, t)
			}
		}
		_ = tRows.Close()

		pinnedIDs := []int64{}
		acctDB := appkit.OpenDB("account")
		pRows, err := acctDB.Query(`SELECT task_id FROM personal_pins ORDER BY pinned_at DESC`)
		if err == nil {
			for pRows.Next() {
				var id int64
				if err := pRows.Scan(&id); err == nil {
					pinnedIDs = append(pinnedIDs, id)
				}
			}
			_ = pRows.Close()
		}

		filter := "all"
		var savedFilter string
		if found, err := appkit.KV("account").Get("filter", &savedFilter); err == nil && found && savedFilter != "" {
			filter = savedFilter
		}

		c.JSON(http.StatusOK, map[string]any{
			"ok":               true,
			"boards":           boards,
			"tasks":            tasks,
			"pinned_ids":       pinnedIDs,
			"filter":           filter,
			"default_priority": defaultPrioritySetting(),
			"user":             c.User(),
		})
	})

	r.Post("/boards", func(c *appkit.Context) {
		if !c.HasPermission("board.manage") {
			c.Error(http.StatusForbidden, "缺少管理看板权限")
			return
		}
		var req struct {
			Title string `json:"title"`
		}
		if err := c.BindJSON(&req); err != nil {
			c.Error(http.StatusBadRequest, "请求格式无效")
			return
		}
		title := strings.TrimSpace(req.Title)
		if title == "" || len([]rune(title)) > 48 {
			c.Error(http.StatusBadRequest, "看板名称须为 1-48 个字符")
			return
		}
		var uid int64
		if u := c.User(); u != nil {
			uid = u.ID
		}
		now := time.Now().UnixMilli()
		res, err := appkit.OpenDB("shared").Exec(
			`INSERT INTO boards (title, created_by, created_at) VALUES (?, ?, ?)`,
			title, uid, now,
		)
		if err != nil {
			c.Error(http.StatusInternalServerError, "创建看板失败")
			return
		}
		id, _ := res.LastInsertId()
		appkit.LogInfo("created board %d (%s)", id, title)
		c.JSON(http.StatusCreated, map[string]any{
			"ok":    true,
			"board": boardItem{ID: id, Title: title, CreatedBy: uid, CreatedAt: now},
		})
	})

	r.Delete("/boards/:id", func(c *appkit.Context) {
		if !c.HasPermission("board.manage") {
			c.Error(http.StatusForbidden, "缺少管理看板权限")
			return
		}
		id, err := strconv.ParseInt(c.Param("id"), 10, 64)
		if err != nil || id <= 0 {
			c.Error(http.StatusBadRequest, "看板编号无效")
			return
		}
		db := appkit.OpenDB("shared")
		tx, err := db.Begin()
		if err != nil {
			c.Error(http.StatusInternalServerError, "开启事务失败")
			return
		}
		if _, err := tx.Exec(`DELETE FROM tasks WHERE board_id = ?`, id); err != nil {
			_ = tx.Rollback()
			c.Error(http.StatusInternalServerError, "清理看板任务失败")
			return
		}
		if _, err := tx.Exec(`DELETE FROM boards WHERE id = ?`, id); err != nil {
			_ = tx.Rollback()
			c.Error(http.StatusInternalServerError, "删除看板失败")
			return
		}
		if err := tx.Commit(); err != nil {
			c.Error(http.StatusInternalServerError, "提交删除失败")
			return
		}
		c.JSON(http.StatusOK, map[string]any{"ok": true})
	})

	r.Post("/tasks", func(c *appkit.Context) {
		if !c.HasPermission("task.write") {
			c.Error(http.StatusForbidden, "缺少编辑任务权限")
			return
		}
		var req struct {
			BoardID  int64  `json:"board_id"`
			Title    string `json:"title"`
			Priority string `json:"priority"`
		}
		if err := c.BindJSON(&req); err != nil {
			c.Error(http.StatusBadRequest, "请求格式无效")
			return
		}
		title := strings.TrimSpace(req.Title)
		if req.BoardID <= 0 || title == "" || len([]rune(title)) > 160 {
			c.Error(http.StatusBadRequest, "任务标题或看板无效")
			return
		}
		priority := strings.TrimSpace(req.Priority)
		if priority == "" {
			priority = defaultPrioritySetting()
		}
		if !validPriority(priority) {
			c.Error(http.StatusBadRequest, "优先级无效")
			return
		}
		var uid int64
		var uname string
		if u := c.User(); u != nil {
			uid, uname = u.ID, u.DisplayName
		}
		now := time.Now().UnixMilli()
		res, err := appkit.OpenDB("shared").Exec(
			`INSERT INTO tasks (board_id, title, status, priority, created_by, created_by_name, created_at) VALUES (?, ?, 'open', ?, ?, ?, ?)`,
			req.BoardID, title, priority, uid, uname, now,
		)
		if err != nil {
			c.Error(http.StatusInternalServerError, "创建任务失败")
			return
		}
		id, _ := res.LastInsertId()
		c.JSON(http.StatusCreated, map[string]any{
			"ok": true,
			"task": taskItem{
				ID: id, BoardID: req.BoardID, Title: title, Status: "open", Priority: priority,
				CreatedBy: uid, CreatedByName: uname, CreatedAt: now,
			},
		})
	})

	r.Patch("/tasks/:id", func(c *appkit.Context) {
		if !c.HasPermission("task.write") {
			c.Error(http.StatusForbidden, "缺少编辑任务权限")
			return
		}
		id, err := strconv.ParseInt(c.Param("id"), 10, 64)
		if err != nil || id <= 0 {
			c.Error(http.StatusBadRequest, "任务编号无效")
			return
		}
		var req struct {
			Title    *string `json:"title"`
			Status   *string `json:"status"`
			Priority *string `json:"priority"`
		}
		if err := c.BindJSON(&req); err != nil {
			c.Error(http.StatusBadRequest, "请求格式无效")
			return
		}
		db := appkit.OpenDB("shared")
		var curTitle, curStatus, curPriority string
		if err := db.QueryRow(`SELECT title, status, priority FROM tasks WHERE id = ?`, id).Scan(&curTitle, &curStatus, &curPriority); err != nil {
			c.Error(http.StatusNotFound, "任务不存在")
			return
		}
		if req.Title != nil {
			t := strings.TrimSpace(*req.Title)
			if t == "" || len([]rune(t)) > 160 {
				c.Error(http.StatusBadRequest, "任务标题无效")
				return
			}
			curTitle = t
		}
		if req.Status != nil {
			if *req.Status != "open" && *req.Status != "done" {
				c.Error(http.StatusBadRequest, "任务状态无效")
				return
			}
			curStatus = *req.Status
		}
		if req.Priority != nil {
			if !validPriority(*req.Priority) {
				c.Error(http.StatusBadRequest, "优先级无效")
				return
			}
			curPriority = *req.Priority
		}
		if _, err := db.Exec(`UPDATE tasks SET title = ?, status = ?, priority = ? WHERE id = ?`, curTitle, curStatus, curPriority, id); err != nil {
			c.Error(http.StatusInternalServerError, "更新任务失败")
			return
		}
		c.JSON(http.StatusOK, map[string]any{"ok": true})
	})

	r.Delete("/tasks/:id", func(c *appkit.Context) {
		if !c.HasPermission("task.write") {
			c.Error(http.StatusForbidden, "缺少编辑任务权限")
			return
		}
		id, err := strconv.ParseInt(c.Param("id"), 10, 64)
		if err != nil || id <= 0 {
			c.Error(http.StatusBadRequest, "任务编号无效")
			return
		}
		if _, err := appkit.OpenDB("shared").Exec(`DELETE FROM tasks WHERE id = ?`, id); err != nil {
			c.Error(http.StatusInternalServerError, "删除任务失败")
			return
		}
		c.JSON(http.StatusOK, map[string]any{"ok": true})
	})

	r.Post("/remind/:id", func(c *appkit.Context) {
		id, err := strconv.ParseInt(c.Param("id"), 10, 64)
		if err != nil || id <= 0 {
			c.Error(http.StatusBadRequest, "任务编号无效")
			return
		}
		var title string
		if err := appkit.OpenDB("shared").QueryRow(`SELECT title FROM tasks WHERE id = ?`, id).Scan(&title); err != nil {
			c.Error(http.StatusNotFound, "任务不存在")
			return
		}
		if err := appkit.NotifySend("待办提醒", title, 0); err != nil {
			c.Error(http.StatusBadGateway, "发送提醒失败")
			return
		}
		c.JSON(http.StatusOK, map[string]any{"ok": true})
	})

	r.Post("/me/pins/:id", func(c *appkit.Context) {
		id, err := strconv.ParseInt(c.Param("id"), 10, 64)
		if err != nil || id <= 0 {
			c.Error(http.StatusBadRequest, "任务编号无效")
			return
		}
		if _, err := appkit.OpenDB("account").Exec(
			`INSERT OR REPLACE INTO personal_pins (task_id, pinned_at) VALUES (?, ?)`,
			id, time.Now().UnixMilli(),
		); err != nil {
			c.Error(http.StatusInternalServerError, "保存置顶失败")
			return
		}
		c.JSON(http.StatusOK, map[string]any{"ok": true})
	})

	r.Delete("/me/pins/:id", func(c *appkit.Context) {
		id, err := strconv.ParseInt(c.Param("id"), 10, 64)
		if err != nil || id <= 0 {
			c.Error(http.StatusBadRequest, "任务编号无效")
			return
		}
		if _, err := appkit.OpenDB("account").Exec(`DELETE FROM personal_pins WHERE task_id = ?`, id); err != nil {
			c.Error(http.StatusInternalServerError, "取消置顶失败")
			return
		}
		c.JSON(http.StatusOK, map[string]any{"ok": true})
	})

	r.Put("/me/filter", func(c *appkit.Context) {
		var req struct {
			Filter string `json:"filter"`
		}
		if err := c.BindJSON(&req); err != nil {
			c.Error(http.StatusBadRequest, "请求格式无效")
			return
		}
		switch req.Filter {
		case "all", "open", "done", "pinned":
		default:
			c.Error(http.StatusBadRequest, "筛选类型无效")
			return
		}
		if _, err := appkit.KV("account").Set("filter", req.Filter); err != nil {
			c.Error(http.StatusInternalServerError, "保存筛选失败")
			return
		}
		c.JSON(http.StatusOK, map[string]any{"ok": true})
	})

	return r
}

func runMigrate(ev appkit.MigrateEvent) error {
	appkit.LogInfo("todo-collab migrate %s -> %s", ev.FromVersion, ev.ToVersion)
	_, err := appkit.KV("shared").Set("schema_app_version", ev.ToVersion)
	return err
}

//go:wasmexport handle
func handle() int32 {
	return appkit.Dispatch(buildRouter())
}

//go:wasmexport migrate
func migrate() int32 {
	return appkit.DispatchMigrate(runMigrate)
}

func main() {}
