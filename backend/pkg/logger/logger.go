package logger

import (
	"encoding/json"
	"fmt"
	"os"
	"time"
)

type Level string

const (
	DEBUG Level = "DEBUG"
	INFO  Level = "INFO"
	WARN  Level = "WARN"
	ERROR Level = "ERROR"
)

type Logger struct {
	service string
}

type entry struct {
	Timestamp string                 `json:"timestamp"`
	Level     Level                  `json:"level"`
	Service   string                 `json:"service"`
	Message   string                 `json:"message"`
	Fields    map[string]interface{} `json:"fields,omitempty"`
}

func New(service string) *Logger {
	return &Logger{service: service}
}

func (l *Logger) log(level Level, msg string, fields map[string]interface{}) {
	e := entry{
		Timestamp: time.Now().UTC().Format(time.RFC3339),
		Level:     level,
		Service:   l.service,
		Message:   msg,
		Fields:    fields,
	}
	b, _ := json.Marshal(e)
	if level == ERROR {
		fmt.Fprintln(os.Stderr, string(b))
	} else {
		fmt.Fprintln(os.Stdout, string(b))
	}
}

func (l *Logger) Info(msg string, fields ...map[string]interface{}) {
	var f map[string]interface{}
	if len(fields) > 0 {
		f = fields[0]
	}
	l.log(INFO, msg, f)
}

func (l *Logger) Error(msg string, fields ...map[string]interface{}) {
	var f map[string]interface{}
	if len(fields) > 0 {
		f = fields[0]
	}
	l.log(ERROR, msg, f)
}

func (l *Logger) Warn(msg string, fields ...map[string]interface{}) {
	var f map[string]interface{}
	if len(fields) > 0 {
		f = fields[0]
	}
	l.log(WARN, msg, f)
}

func (l *Logger) Debug(msg string, fields ...map[string]interface{}) {
	var f map[string]interface{}
	if len(fields) > 0 {
		f = fields[0]
	}
	l.log(DEBUG, msg, f)
}

var Default = New("gateway")
