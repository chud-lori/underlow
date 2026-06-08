package main

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestHealth(t *testing.T) {
	handler := testHandler(t, t.TempDir(), 128*1024)

	response := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/api/health", nil)
	handler.ServeHTTP(response, request)

	var body healthResponse
	decodeResponse(t, response, &body)

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusOK)
	}
	if !body.OK || body.Service != serviceName {
		t.Fatalf("body = %#v", body)
	}
}

func TestCompileCAcceptsCodeAndSource(t *testing.T) {
	handler := testHandler(t, t.TempDir(), 128*1024)

	for name, payload := range map[string]string{
		"code":   `{"code":"int add(int a, int b) { return a + b; }\n"}`,
		"source": `{"source":"int main(void) { return 0; }\n"}`,
	} {
		t.Run(name, func(t *testing.T) {
			response := postJSON(handler, "/api/compile/c", payload)

			var body compileResponse
			decodeResponse(t, response, &body)

			if response.Code != http.StatusOK {
				t.Fatalf("status = %d, want %d", response.Code, http.StatusOK)
			}
			if !body.OK {
				t.Fatalf("compile failed: %s", body.Diagnostics)
			}
			if !strings.Contains(body.Assembly, ":") {
				t.Fatalf("assembly did not include a label: %q", body.Assembly)
			}
		})
	}
}

func TestCompileCReportsDiagnostics(t *testing.T) {
	handler := testHandler(t, t.TempDir(), 128*1024)
	response := postJSON(handler, "/api/compile/c", `{"code":"int main( { return 0; }\n"}`)

	var body compileResponse
	decodeResponse(t, response, &body)

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusOK)
	}
	if body.OK {
		t.Fatalf("expected compile failure")
	}
	if body.Assembly != "" || !strings.Contains(body.Diagnostics, "error:") {
		t.Fatalf("body = %#v", body)
	}
}

func TestCompileCRejectsMissingCodeInvalidJSONAndLargeBodies(t *testing.T) {
	handler := testHandler(t, t.TempDir(), 32)

	tests := []struct {
		name    string
		payload string
		status  int
		match   string
	}{
		{name: "missing code", payload: `{}`, status: http.StatusBadRequest, match: "code"},
		{name: "non-string code", payload: `{"code":12}`, status: http.StatusBadRequest, match: "code"},
		{name: "invalid json", payload: `{`, status: http.StatusBadRequest, match: "valid JSON"},
		{name: "too large", payload: `{"code":"` + strings.Repeat("x", 64) + `"}`, status: http.StatusRequestEntityTooLarge, match: "too large"},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			response := postJSON(handler, "/api/compile/c", test.payload)

			var body compileResponse
			decodeResponse(t, response, &body)

			if response.Code != test.status {
				t.Fatalf("status = %d, want %d", response.Code, test.status)
			}
			if body.OK || !strings.Contains(body.Diagnostics, test.match) {
				t.Fatalf("body = %#v", body)
			}
		})
	}
}

func TestOptionsAndNotFound(t *testing.T) {
	handler := testHandler(t, t.TempDir(), 128*1024)

	options := httptest.NewRecorder()
	handler.ServeHTTP(options, httptest.NewRequest(http.MethodOptions, "/api/compile/c", nil))
	if options.Code != http.StatusNoContent {
		t.Fatalf("OPTIONS status = %d, want %d", options.Code, http.StatusNoContent)
	}

	notFound := httptest.NewRecorder()
	handler.ServeHTTP(notFound, httptest.NewRequest(http.MethodGet, "/api/compile/c", nil))

	var body compileResponse
	decodeResponse(t, notFound, &body)
	if notFound.Code != http.StatusNotFound || body.Diagnostics != "Not found" {
		t.Fatalf("not found response = %d %#v", notFound.Code, body)
	}
}

func TestStaticFilesAndTraversal(t *testing.T) {
	staticDir := t.TempDir()
	if err := os.WriteFile(filepath.Join(staticDir, "index.html"), []byte("<h1>Underlow</h1>"), 0o600); err != nil {
		t.Fatal(err)
	}
	handler := testHandler(t, staticDir, 128*1024)

	index := httptest.NewRecorder()
	handler.ServeHTTP(index, httptest.NewRequest(http.MethodGet, "/", nil))
	if index.Code != http.StatusOK || !strings.Contains(index.Body.String(), "Underlow") {
		t.Fatalf("index response = %d %q", index.Code, index.Body.String())
	}

	forbidden := httptest.NewRecorder()
	handler.ServeHTTP(forbidden, httptest.NewRequest(http.MethodGet, "/../go.mod", nil))
	if forbidden.Code != http.StatusForbidden && forbidden.Code != http.StatusBadRequest {
		t.Fatalf("traversal status = %d, want forbidden-style rejection", forbidden.Code)
	}
}

func testHandler(t *testing.T, staticDir string, maxBodyBytes int64) http.Handler {
	t.Helper()
	handler, err := newHandler(serverConfig{
		StaticDir:    staticDir,
		Timeout:      2 * time.Second,
		MaxBodyBytes: maxBodyBytes,
	})
	if err != nil {
		t.Fatal(err)
	}
	return handler
}

func postJSON(handler http.Handler, path string, payload string) *httptest.ResponseRecorder {
	response := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, path, bytes.NewBufferString(payload))
	request.Header.Set("Content-Type", "application/json")
	handler.ServeHTTP(response, request)
	return response
}

func decodeResponse(t *testing.T, response *httptest.ResponseRecorder, target any) {
	t.Helper()
	if err := json.NewDecoder(response.Body).Decode(target); err != nil {
		t.Fatalf("decode response: %v", err)
	}
}
