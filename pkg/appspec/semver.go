package appspec

import (
	"strconv"
	"strings"
)

// CompareVersions 按 semver 比较两个版本号：a<b 返回负数，相等返回 0，a>b 返回正数。
// 构建元数据（+ 之后）不参与比较；有预发布标识的版本低于同号正式版。
func CompareVersions(a, b string) int {
	a, _, _ = strings.Cut(a, "+")
	b, _, _ = strings.Cut(b, "+")
	coreA, preA, _ := strings.Cut(a, "-")
	coreB, preB, _ := strings.Cut(b, "-")
	partsA, partsB := strings.Split(coreA, "."), strings.Split(coreB, ".")
	for i := 0; i < 3; i++ {
		if diff := numberAt(partsA, i) - numberAt(partsB, i); diff != 0 {
			if diff < 0 {
				return -1
			}
			return 1
		}
	}
	switch {
	case preA == preB:
		return 0
	case preA == "":
		return 1
	case preB == "":
		return -1
	}
	idsA, idsB := strings.Split(preA, "."), strings.Split(preB, ".")
	for i := 0; i < len(idsA) && i < len(idsB); i++ {
		if result := compareIdentifier(idsA[i], idsB[i]); result != 0 {
			return result
		}
	}
	return len(idsA) - len(idsB)
}

func numberAt(parts []string, index int) int {
	if index >= len(parts) {
		return 0
	}
	value, _ := strconv.Atoi(parts[index])
	return value
}

func compareIdentifier(a, b string) int {
	numberA, errA := strconv.Atoi(a)
	numberB, errB := strconv.Atoi(b)
	switch {
	case errA == nil && errB == nil:
		return numberA - numberB
	case errA == nil:
		return -1
	case errB == nil:
		return 1
	}
	return strings.Compare(a, b)
}
