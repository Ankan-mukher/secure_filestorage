import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import axios from 'axios';
import { Download, File, Image, Film, FileText, Music, AlertTriangle, ShieldAlert } from 'lucide-react';

const API_URL = 'http://localhost:8000';

const formatBytes = (bytes, decimals = 2) => {
  if (!bytes) return '0 Bytes';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
};

export default function SharedPreview() {
  const { fileId } = useParams();
  const [fileData, setFileData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const fetchMetadata = async () => {
      try {
        const response = await axios.get(`${API_URL}/files/${fileId}`);
        setFileData(response.data);
      } catch (err) {
        if (err.response?.status === 403) {
          setError('This file is private. Access is restricted to the file owner.');
        } else {
          setError('File not found or has been deleted.');
        }
      } finally {
        setLoading(false);
      }
    };
    fetchMetadata();
  }, [fileId]);

  const getFileIcon = (contentType) => {
    if (!contentType) return <File className="shared-preview-icon" />;
    if (contentType.startsWith('image/')) return <Image className="shared-preview-icon" />;
    if (contentType.startsWith('video/')) return <Film className="shared-preview-icon" />;
    if (contentType.startsWith('audio/')) return <Music className="shared-preview-icon" />;
    if (contentType === 'application/pdf' || contentType.startsWith('text/')) return <FileText className="shared-preview-icon" />;
    return <File className="shared-preview-icon" />;
  };

  const renderPreview = () => {
    if (!fileData) return null;
    const { content_type } = fileData;
    const downloadUrl = `${API_URL}/files/${fileId}/download`;

    if (content_type && content_type.startsWith('image/')) {
      return (
        <div className="shared-media-container">
          <img src={downloadUrl} alt={fileData.filename} className="shared-preview-image" />
        </div>
      );
    }

    if (content_type && content_type.startsWith('video/')) {
      return (
        <div className="shared-media-container">
          <video src={downloadUrl} controls className="shared-preview-video" />
        </div>
      );
    }

    if (content_type === 'application/pdf') {
      return (
        <div className="shared-media-container" style={{ height: '300px', width: '100%' }}>
          <embed src={downloadUrl} type="application/pdf" width="100%" height="100%" />
        </div>
      );
    }

    return (
      <div style={{ padding: '20px' }}>
        {getFileIcon(content_type)}
      </div>
    );
  };

  if (loading) {
    return (
      <div className="shared-preview-container">
        <div className="shared-preview-card">
          <p style={{ color: '#94a3b8' }}>Loading shared file details...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="shared-preview-container">
        <div className="shared-preview-card">
          <div className="stat-icon-wrapper" style={{ background: 'rgba(239, 68, 68, 0.1)', color: '#ef4444', width: '60px', height: '60px', borderRadius: '50%' }}>
            <ShieldAlert size={32} />
          </div>
          <h2 style={{ fontSize: '20px' }}>Access Blocked</h2>
          <p style={{ color: '#94a3b8', margin: '0' }}>{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="shared-preview-container">
      <div className="shared-preview-card">
        {renderPreview()}

        <div className="shared-file-info">
          <h2>{fileData.filename}</h2>
          <span className="shared-file-size">{formatBytes(fileData.file_size)}</span>
        </div>

        <div className="shared-metadata-grid">
          <div className="shared-meta-item">
            <label>Content Type</label>
            <span>{fileData.content_type || 'Unknown'}</span>
          </div>
          <div className="shared-meta-item">
            <label>Shared On</label>
            <span>{new Date(fileData.created_at).toLocaleDateString()}</span>
          </div>
        </div>

        <a
          href={`${API_URL}/files/${fileData.id}/download`}
          download={fileData.filename}
          className="btn btn-primary"
          style={{ width: '100%' }}
        >
          <Download size={18} /> Download File
        </a>
      </div>
    </div>
  );
}
