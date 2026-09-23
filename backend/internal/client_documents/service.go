package client_documents

import (
	"context"
	"database/sql"
	"fmt"
	"io"
	"mime/multipart"
	"os"
	"path/filepath"
	"time"

	"github.com/google/uuid"
)

type Document struct {
	ID              string     `json:"id"`
	ClientID        string     `json:"client_id"`
	DocumentType    string     `json:"document_type"`
	FileName        string     `json:"file_name"`
	FileSize        int64      `json:"file_size"`
	MimeType        string     `json:"mime_type"`
	Status          string     `json:"status"`
	RejectionReason string     `json:"rejection_reason,omitempty"`
	UploadedAt      time.Time  `json:"uploaded_at"`
	ReviewedAt      *time.Time `json:"reviewed_at,omitempty"`
}

type Service struct {
	db        *sql.DB
	uploadDir string
}

func NewService(db *sql.DB, uploadDir string) *Service {
	os.MkdirAll(uploadDir, 0755)
	return &Service{db: db, uploadDir: uploadDir}
}

func (s *Service) Upload(ctx context.Context, clientID, docType string, fh *multipart.FileHeader) (*Document, error) {
	src, err := fh.Open()
	if err != nil {
		return nil, err
	}
	defer src.Close()

	ext := filepath.Ext(fh.Filename)
	fileID := uuid.New().String()
	dirPath := filepath.Join(s.uploadDir, clientID)
	os.MkdirAll(dirPath, 0755)
	filePath := filepath.Join(dirPath, fileID+ext)

	dst, err := os.Create(filePath)
	if err != nil {
		return nil, fmt.Errorf("create file: %w", err)
	}
	defer dst.Close()
	if _, err := io.Copy(dst, src); err != nil {
		return nil, fmt.Errorf("write file: %w", err)
	}

	var doc Document
	err = s.db.QueryRowContext(ctx,
		`INSERT INTO client_documents (client_id, document_type, file_name, file_path, file_size, mime_type, status)
		 VALUES ($1, $2, $3, $4, $5, $6, 'PENDING')
		 RETURNING id, client_id, document_type, file_name, file_size, mime_type, status, uploaded_at`,
		clientID, docType, fh.Filename, filePath, fh.Size, fh.Header.Get("Content-Type"),
	).Scan(&doc.ID, &doc.ClientID, &doc.DocumentType, &doc.FileName,
		&doc.FileSize, &doc.MimeType, &doc.Status, &doc.UploadedAt)
	if err != nil {
		os.Remove(filePath)
		return nil, err
	}
	return &doc, nil
}

func (s *Service) List(ctx context.Context, clientID string) ([]Document, error) {
	rows, err := s.db.QueryContext(ctx,
		`SELECT id, client_id, document_type, file_name, file_size, mime_type, status,
		        rejection_reason, uploaded_at, reviewed_at
		 FROM client_documents WHERE client_id = $1 ORDER BY uploaded_at DESC`,
		clientID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var docs []Document
	for rows.Next() {
		var d Document
		var reason sql.NullString
		err := rows.Scan(&d.ID, &d.ClientID, &d.DocumentType, &d.FileName, &d.FileSize,
			&d.MimeType, &d.Status, &reason, &d.UploadedAt, &d.ReviewedAt)
		if err != nil {
			return nil, err
		}
		d.RejectionReason = reason.String
		docs = append(docs, d)
	}
	return docs, nil
}

func (s *Service) AdminReview(ctx context.Context, docID, status, reason, reviewerID string) error {
	_, err := s.db.ExecContext(ctx,
		`UPDATE client_documents SET status = $1, rejection_reason = $2,
		  reviewed_at = NOW(), reviewed_by = $3
		 WHERE id = $4`,
		status, reason, reviewerID, docID)
	return err
}

func (s *Service) AdminListAll(ctx context.Context, status string) ([]Document, error) {
	query := `SELECT id, client_id, document_type, file_name, file_size, mime_type, status,
	                 rejection_reason, uploaded_at, reviewed_at
	          FROM client_documents`
	if status != "" {
		query += " WHERE status = '" + status + "'"
	}
	query += " ORDER BY uploaded_at DESC LIMIT 100"

	rows, err := s.db.QueryContext(ctx, query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var docs []Document
	for rows.Next() {
		var d Document
		var reason sql.NullString
		rows.Scan(&d.ID, &d.ClientID, &d.DocumentType, &d.FileName, &d.FileSize,
			&d.MimeType, &d.Status, &reason, &d.UploadedAt, &d.ReviewedAt)
		d.RejectionReason = reason.String
		docs = append(docs, d)
	}
	return docs, nil
}
