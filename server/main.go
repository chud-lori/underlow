package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

const (
	defaultTimeout      = 3 * time.Second
	defaultMaxBodyBytes = 128 * 1024
	serviceName         = "underlow-backend"
)

type serverConfig struct {
	StaticDir    string
	Timeout      time.Duration
	MaxBodyBytes int64
}

type healthResponse struct {
	OK      bool   `json:"ok"`
	Service string `json:"service"`
}

type compileResponse struct {
	OK          bool   `json:"ok"`
	Assembly    string `json:"assembly"`
	Diagnostics string `json:"diagnostics"`
}

type compileRequest struct {
	Code   any `json:"code"`
	Source any `json:"source"`
}

type appServer struct {
	staticDir    string
	timeout      time.Duration
	maxBodyBytes int64
}

func main() {
	host := envOrDefault("HOST", "127.0.0.1")
	port := envOrDefault("PORT", "8121")

	handler, err := newHandler(serverConfig{})
	if err != nil {
		log.Fatal(err)
	}

	address := net.JoinHostPort(host, port)
	log.Printf("Underlow backend listening at http://%s", address)
	if err := http.ListenAndServe(address, handler); err != nil {
		log.Fatal(err)
	}
}

func newHandler(config serverConfig) (http.Handler, error) {
	staticDir := config.StaticDir
	if staticDir == "" {
		staticDir = os.Getenv("UNDERLOW_ROOT")
		if staticDir == "" {
			cwd, err := os.Getwd()
			if err != nil {
				return nil, err
			}
			staticDir = cwd
		}
	}

	absStaticDir, err := filepath.Abs(staticDir)
	if err != nil {
		return nil, err
	}

	timeout := config.Timeout
	if timeout == 0 {
		timeout = defaultTimeout
	}

	maxBodyBytes := config.MaxBodyBytes
	if maxBodyBytes == 0 {
		maxBodyBytes = defaultMaxBodyBytes
	}

	return &appServer{
		staticDir:    absStaticDir,
		timeout:      timeout,
		maxBodyBytes: maxBodyBytes,
	}, nil
}

func (server *appServer) ServeHTTP(response http.ResponseWriter, request *http.Request) {
	setCORS(response)

	if request.Method == http.MethodOptions {
		response.WriteHeader(http.StatusNoContent)
		return
	}

	switch {
	case request.Method == http.MethodGet && request.URL.Path == "/api/health":
		sendJSON(response, http.StatusOK, healthResponse{OK: true, Service: serviceName})
	case request.Method == http.MethodPost && request.URL.Path == "/api/compile/c":
		server.handleCompileC(response, request)
	case request.Method == http.MethodGet || request.Method == http.MethodHead:
		server.handleStatic(response, request)
	default:
		sendJSON(response, http.StatusNotFound, compileResponse{OK: false, Assembly: "", Diagnostics: "Not found"})
	}
}

func (server *appServer) handleCompileC(response http.ResponseWriter, request *http.Request) {
	defer request.Body.Close()
	request.Body = http.MaxBytesReader(response, request.Body, server.maxBodyBytes)

	var body compileRequest
	decoder := json.NewDecoder(request.Body)
	if err := decoder.Decode(&body); err != nil {
		status := http.StatusBadRequest
		message := "Request body must be valid JSON"
		var maxBytesError *http.MaxBytesError
		if errors.As(err, &maxBytesError) {
			status = http.StatusRequestEntityTooLarge
			message = "Request body is too large"
		}
		sendJSON(response, status, compileResponse{OK: false, Assembly: "", Diagnostics: message})
		return
	}

	if err := decoder.Decode(&struct{}{}); err != io.EOF {
		sendJSON(response, http.StatusBadRequest, compileResponse{OK: false, Assembly: "", Diagnostics: "Request body must be valid JSON"})
		return
	}

	code, ok := body.Code.(string)
	if !ok {
		code, ok = body.Source.(string)
	}
	if !ok {
		sendJSON(response, http.StatusBadRequest, compileResponse{OK: false, Assembly: "", Diagnostics: "Expected JSON body with string field: code"})
		return
	}

	result := compileCToAssembly(request.Context(), code, server.timeout)
	sendJSON(response, http.StatusOK, result)
}

func (server *appServer) handleStatic(response http.ResponseWriter, request *http.Request) {
	path := request.URL.EscapedPath()
	if path == "" || path == "/" {
		path = "/index.html"
	}

	decodedPath, err := filepath.Localize(strings.TrimPrefix(path, "/"))
	if err != nil {
		sendJSON(response, http.StatusForbidden, compileResponse{OK: false, Assembly: "", Diagnostics: "Forbidden"})
		return
	}

	filePath := filepath.Join(server.staticDir, decodedPath)
	absFilePath, err := filepath.Abs(filePath)
	if err != nil || !isWithin(server.staticDir, absFilePath) {
		sendJSON(response, http.StatusForbidden, compileResponse{OK: false, Assembly: "", Diagnostics: "Forbidden"})
		return
	}

	info, err := os.Stat(absFilePath)
	if err != nil || info.IsDir() {
		sendJSON(response, http.StatusNotFound, compileResponse{OK: false, Assembly: "", Diagnostics: "Not found"})
		return
	}

	http.ServeFile(response, request, absFilePath)
}

func compileCToAssembly(parent context.Context, source string, timeout time.Duration) compileResponse {
	dir, err := os.MkdirTemp("", "underlow-c-")
	if err != nil {
		return compileResponse{OK: false, Assembly: "", Diagnostics: err.Error()}
	}
	defer os.RemoveAll(dir)

	inputPath := filepath.Join(dir, "input.c")
	outputPath := filepath.Join(dir, "output.s")
	if err := os.WriteFile(inputPath, []byte(source), 0o600); err != nil {
		return compileResponse{OK: false, Assembly: "", Diagnostics: err.Error()}
	}

	ctx, cancel := context.WithTimeout(parent, timeout)
	defer cancel()

	command := exec.CommandContext(ctx, "clang",
		"-S",
		"-O0",
		"-fno-color-diagnostics",
		"-Wall",
		"-Wextra",
		"-x",
		"c",
		inputPath,
		"-o",
		outputPath,
	)

	output, err := command.CombinedOutput()
	diagnostics := string(output)
	if errors.Is(ctx.Err(), context.DeadlineExceeded) {
		diagnostics = fmt.Sprintf("%sCompilation timed out after %dms.\n", diagnostics, timeout.Milliseconds())
		return compileResponse{OK: false, Assembly: "", Diagnostics: diagnostics}
	}
	if err != nil {
		return compileResponse{OK: false, Assembly: "", Diagnostics: diagnostics}
	}

	assembly, err := os.ReadFile(outputPath)
	if err != nil {
		return compileResponse{OK: false, Assembly: "", Diagnostics: err.Error()}
	}

	return compileResponse{OK: true, Assembly: string(assembly), Diagnostics: diagnostics}
}

func sendJSON(response http.ResponseWriter, status int, payload any) {
	response.Header().Set("Content-Type", "application/json; charset=utf-8")
	response.WriteHeader(status)
	if err := json.NewEncoder(response).Encode(payload); err != nil {
		log.Printf("write json response: %v", err)
	}
}

func setCORS(response http.ResponseWriter) {
	response.Header().Set("Access-Control-Allow-Origin", "*")
	response.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
	response.Header().Set("Access-Control-Allow-Headers", "content-type")
}

func isWithin(root string, filePath string) bool {
	relative, err := filepath.Rel(root, filePath)
	return err == nil && relative != ".." && !strings.HasPrefix(relative, ".."+string(os.PathSeparator))
}

func envOrDefault(name string, fallback string) string {
	value := os.Getenv(name)
	if value == "" {
		return fallback
	}
	if name == "PORT" {
		if _, err := strconv.Atoi(value); err != nil {
			return fallback
		}
	}
	return value
}
