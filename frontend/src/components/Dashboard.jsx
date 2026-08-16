import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { 
  File, FolderPlus, Folder, Upload, Trash2, Globe, Lock, Link, MoreVertical, 
  Move, Download, LogOut, HardDrive, Search, Image, FileText, Film, 
  Music, Plus, X, ChevronRight, Check, Eye
} from 'lucide-react';

const API_URL = import.meta.env.VITE_API_URL;

const formatBytes = (bytes, decimals = 2) => {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
};

export default function Dashboard() {
  const [user, setUser] = useState(null);
  const [files, setFiles] = useState([]);
  const [folders, setFolders] = useState([]);
  
  // Filtering & Sorting
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState(''); // '', 'image', 'document', 'video', 'audio', 'other'
  const [selectedFolderId, setSelectedFolderId] = useState(null); // null = all, -1 = root (no folder), positive = folder_id
  const [sortBy, setSortBy] = useState('created_at');
  const [sortOrder, setSortOrder] = useState('desc');

  // Modals & Forms
  const [showFolderModal, setShowFolderModal] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [showMoveModal, setShowMoveModal] = useState(null); // file object to move
  const [moveDestFolderId, setMoveDestFolderId] = useState('');
  const [showDeleteModal, setShowDeleteModal] = useState(null); // file object to delete
  
  // Dropdown menu track
  const [activeMenuId, setActiveMenuId] = useState(null);
  
  // Upload status track
  const [uploads, setUploads] = useState([]); // Array of { id, name, progress, status, error }
  const [toasts, setToasts] = useState([]); // Array of { id, message, type }

  // Drag and drop state
  const [dragActive, setDragActive] = useState(false);
  
  const navigate = useNavigate();
  const fileInputRef = useRef(null);

  // Axios instance with token config
  const getAxios = () => {
    const token = localStorage.getItem('token');
    return axios.create({
      baseURL: API_URL,
      headers: {
        Authorization: `Bearer ${token}`
      }
    });
  };

  const showToast = (message, type = 'success') => {
    const id = Date.now();
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 4000);
  };

  const fetchUser = async () => {
    try {
      const response = await getAxios().get('/auth/me');
      setUser(response.data);
    } catch (err) {
      localStorage.removeItem('token');
      navigate('/login');
    }
  };

  const fetchFolders = async () => {
    try {
      const response = await getAxios().get('/folders');
      setFolders(response.data);
    } catch (err) {
      console.error('Failed to fetch folders', err);
    }
  };

  const fetchFiles = async () => {
    try {
      const params = {
        sort_by: sortBy,
        sort_order: sortOrder
      };
      if (search) params.search = search;
      if (category) params.category = category;
      if (selectedFolderId !== null) params.folder_id = selectedFolderId;

      const response = await getAxios().get('/files', { params });
      setFiles(response.data);
    } catch (err) {
      console.error('Failed to fetch files', err);
    }
  };

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token) {
      navigate('/login');
      return;
    }
    fetchUser();
    fetchFolders();
  }, []);

  useEffect(() => {
    if (user) {
      fetchFiles();
    }
  }, [user, search, category, selectedFolderId, sortBy, sortOrder]);

  const handleLogout = () => {
    localStorage.removeItem('token');
    navigate('/login');
  };

  const handleCreateFolder = async (e) => {
    e.preventDefault();
    if (!newFolderName.trim()) return;

    try {
      await getAxios().post('/folders', { name: newFolderName });
      setNewFolderName('');
      setShowFolderModal(false);
      showToast('Folder created successfully!');
      fetchFolders();
    } catch (err) {
      showToast(err.response?.data?.detail || 'Failed to create folder', 'error');
    }
  };

  const handleDeleteFolder = async (folderId, folderName) => {
    if (!window.confirm(`Are you sure you want to delete folder "${folderName}"? Files in this folder will NOT be deleted, but moved to Root.`)) {
      return;
    }

    try {
      await getAxios().delete(`/folders/${folderId}`);
      showToast('Folder deleted successfully!');
      if (selectedFolderId === folderId) {
        setSelectedFolderId(null);
      }
      fetchFolders();
      fetchFiles();
    } catch (err) {
      showToast(err.response?.data?.detail || 'Failed to delete folder', 'error');
    }
  };

  // Upload handler with progress tracking
  const handleUploadFiles = (fileList) => {
    if (!fileList || fileList.length === 0) return;

    const filesToUpload = Array.from(fileList);
    
    // Validate file sizes first
    for (let f of filesToUpload) {
      if (f.size > 100 * 1024 * 1024) {
        showToast(`File "${f.name}" exceeds the 100 MB upload limit.`, 'error');
        return;
      }
    }

    setShowUploadModal(false);

    filesToUpload.forEach(file => {
      const uploadId = Date.now() + Math.random().toString(36).substr(2, 9);
      
      setUploads(prev => [...prev, {
        id: uploadId,
        name: file.name,
        progress: 0,
        status: 'uploading'
      }]);

      const formData = new FormData();
      formData.append('file', file);

      // determine upload destination folder
      let uploadFolderId = null;
      if (selectedFolderId !== null && selectedFolderId !== -1) {
        uploadFolderId = selectedFolderId;
      }

      const uploadUrl = uploadFolderId ? `/files/upload?folder_id=${uploadFolderId}` : '/files/upload';

      const token = localStorage.getItem('token');
      getAxios().post(uploadUrl, formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
          'Authorization': `Bearer ${token}`
        },
        onUploadProgress: (progressEvent) => {
          if (progressEvent.total) {
            const percentCompleted = Math.round((progressEvent.loaded * 100) / progressEvent.total);
            setUploads(prev => prev.map(item => 
              item.id === uploadId ? { ...item, progress: percentCompleted } : item
            ));
          }
        }
      })
      .then(res => {
        setUploads(prev => prev.map(item => 
          item.id === uploadId ? { ...item, status: 'success', progress: 100 } : item
        ));
        showToast(`File "${file.name}" uploaded successfully!`);
        fetchFiles();
      })
      .catch(err => {
        setUploads(prev => prev.map(item => 
          item.id === uploadId ? { 
            ...item, 
            status: 'error', 
            error: err.response?.data?.detail || 'Upload failed' 
          } : item
        ));
        showToast(`Failed to upload "${file.name}"`, 'error');
      });
    });
  };

  const handleDrag = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleUploadFiles(e.dataTransfer.files);
    }
  };

  const confirmDeleteFile = async () => {
    if (!showDeleteModal) return;

    try {
      await getAxios().delete(`/files/${showDeleteModal.id}`);
      showToast('File deleted successfully.');
      setShowDeleteModal(null);
      fetchFiles();
    } catch (err) {
      showToast(err.response?.data?.detail || 'Failed to delete file', 'error');
    }
  };

  const handleToggleVisibility = async (fileId, currentIsPublic) => {
    try {
      const response = await getAxios().patch(`/files/${fileId}/visibility`, {
        is_public: !currentIsPublic
      });
      showToast(`File is now ${response.data.is_public ? 'Public' : 'Private'}.`);
      fetchFiles();
    } catch (err) {
      showToast('Failed to change file visibility.', 'error');
    }
  };

  const handleMoveFile = async (e) => {
    e.preventDefault();
    if (!showMoveModal) return;

    try {
      const folderId = moveDestFolderId === 'root' ? null : parseInt(moveDestFolderId);
      await getAxios().patch(`/files/${showMoveModal.id}/move`, {
        folder_id: folderId
      });
      showToast(`File moved successfully!`);
      setShowMoveModal(null);
      setMoveDestFolderId('');
      fetchFiles();
    } catch (err) {
      showToast(err.response?.data?.detail || 'Failed to move file', 'error');
    }
  };

  const handleCopyLink = (fileId) => {
    const shareUrl = `${window.location.origin}/shared/${fileId}`;
    navigator.clipboard.writeText(shareUrl)
      .then(() => showToast('Shareable link copied to clipboard!'))
      .catch(() => showToast('Failed to copy link', 'error'));
  };

  const getFileThumbnailIcon = (file) => {
    const { content_type, id } = file;
    const token = localStorage.getItem('token');
    const downloadUrl = `${API_URL}/files/${id}/download?token=${token}`;

    if (content_type && content_type.startsWith('image/')) {
      return <img src={downloadUrl} alt={file.filename} className="file-thumbnail" />;
    }
    if (content_type && content_type.startsWith('video/')) {
      return <Film className="file-type-icon" />;
    }
    if (content_type && content_type.startsWith('audio/')) {
      return <Music className="file-type-icon" />;
    }
    if (content_type === 'application/pdf') {
      return <FileText className="file-type-icon" style={{ color: '#ef4444' }} />;
    }
    return <File className="file-type-icon" />;
  };

  // Calculate space details
  const totalSpace = 2 * 1024 * 1024 * 1024; // 2 GB mock quota
  const usedSpace = files.reduce((acc, f) => acc + f.file_size, 0);
  const usagePercentage = Math.min((usedSpace / totalSpace) * 100, 100);

  return (
    <div className="dashboard-root">
      {/* Toast Notification Container */}
      <div className="toast-container">
        {toasts.map(toast => (
          <div key={toast.id} className={`toast ${toast.type}`}>
            {toast.message}
          </div>
        ))}
      </div>

      {/* Sidebar navigation */}
      <div className="sidebar">
        <div className="logo-container">
          <HardDrive className="logo-icon" />
          <span className="logo-text">AROKHHO 🔐</span>
        </div>

        <div className="sidebar-nav">
          <button 
            className={`nav-item ${selectedFolderId === null ? 'active' : ''}`}
            onClick={() => { setSelectedFolderId(null); setCategory(''); }}
          >
            <HardDrive size={18} />
            All Files
          </button>
          
          <button 
            className={`nav-item ${selectedFolderId === -1 ? 'active' : ''}`}
            onClick={() => { setSelectedFolderId(-1); setCategory(''); }}
          >
            <Folder size={18} />
            Root Folder (Unorganized)
          </button>

          <div style={{ marginTop: '20px', padding: '0 16px' }}>
            <label style={{ fontSize: '10px', color: '#64748b' }}>Folders</label>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', maxHeight: '200px', overflowY: 'auto', padding: '0 4px' }}>
            {folders.map(f => (
              <button
                key={f.id}
                className={`nav-item ${selectedFolderId === f.id ? 'active' : ''}`}
                onClick={() => { setSelectedFolderId(f.id); setCategory(''); }}
                style={{ paddingRight: '8px', display: 'flex', justifyContent: 'space-between' }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', minWidth: 0 }}>
                  <Folder size={18} className="folder-icon" />
                  <span style={{ textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>{f.name}</span>
                </div>
                <Trash2 
                  size={14} 
                  className="folder-delete-btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDeleteFolder(f.id, f.name);
                  }}
                />
              </button>
            ))}
          </div>
        </div>

        <div className="sidebar-footer">
          <div className="storage-widget">
            <div className="storage-title">Storage Used</div>
            <div className="storage-bar-bg">
              <div className="storage-bar-fill" style={{ width: `${usagePercentage}%` }}></div>
            </div>
            <div className="storage-text">
              {formatBytes(usedSpace)} of {formatBytes(totalSpace)} used
            </div>
          </div>

          {user && (
            <div className="user-badge">
              <div className="user-avatar">
                {user.email.substring(0, 2).toUpperCase()}
              </div>
              <div className="user-info">
                <span className="user-email" title={user.email}>{user.email}</span>
                <span className="user-role">Authenticated User</span>
              </div>
              <button 
                onClick={handleLogout}
                className="btn-icon-only btn-secondary" 
                style={{ marginLeft: 'auto', padding: '6px' }}
                title="Sign Out"
              >
                <LogOut size={16} />
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Main panel */}
      <div className="main-content">
        <div className="dashboard-header">
          <div className="header-search">
            <Search className="search-icon" />
            <input 
              type="text" 
              placeholder="Search files by name..." 
              className="search-input"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          <div className="header-actions">
            <button className="btn btn-secondary" onClick={() => setShowFolderModal(true)}>
              <FolderPlus size={18} /> New Folder
            </button>
            <button className="btn btn-primary" onClick={() => setShowUploadModal(true)}>
              <Upload size={18} /> Upload File
            </button>
          </div>
        </div>

        <div className="content-pane">
          {/* Quick Statistics Cards */}
          <div className="stats-grid">
            <div className="stat-card">
              <div className="stat-icon-wrapper">
                <FileText size={20} />
              </div>
              <div className="stat-info">
                <h4>Total Files</h4>
                <div className="stat-value">{files.length}</div>
              </div>
            </div>
            <div className="stat-card">
              <div className="stat-icon-wrapper" style={{ background: 'rgba(16, 185, 129, 0.1)', color: '#10b981' }}>
                <Globe size={20} />
              </div>
              <div className="stat-info">
                <h4>Public Files</h4>
                <div className="stat-value">{files.filter(f => f.is_public).length}</div>
              </div>
            </div>
            <div className="stat-card">
              <div className="stat-icon-wrapper" style={{ background: 'rgba(245, 158, 11, 0.1)', color: '#f59e0b' }}>
                <Folder size={20} />
              </div>
              <div className="stat-info">
                <h4>Total Folders</h4>
                <div className="stat-value">{folders.length}</div>
              </div>
            </div>
          </div>

          {/* Folders Shelf - Show only when in All Files view */}
          {selectedFolderId === null && folders.length > 0 && (
            <div className="folders-section">
              <div className="section-title-bar">
                <h3 className="section-title">Folders</h3>
              </div>
              <div className="folders-grid">
                {folders.map(f => (
                  <div 
                    key={f.id} 
                    className="folder-card"
                    onClick={() => setSelectedFolderId(f.id)}
                  >
                    <div className="folder-details">
                      <Folder size={20} className="folder-icon" />
                      <span className="folder-name">{f.name}</span>
                    </div>
                    <ChevronRight size={16} style={{ color: '#64748b' }} />
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Files section */}
          <div className="files-section">
            <div className="filters-bar">
              <div className="category-tabs">
                {[
                  { label: 'All Files', value: '' },
                  { label: 'Images', value: 'image' },
                  { label: 'Documents', value: 'document' },
                  { label: 'Media', value: 'video' },
                  { label: 'Audio', value: 'audio' },
                  { label: 'Others', value: 'other' }
                ].map(tab => (
                  <button
                    key={tab.label}
                    className={`category-tab ${category === tab.value ? 'active' : ''}`}
                    onClick={() => setCategory(tab.value)}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>

              <div className="sorting-controls">
                <span style={{ fontSize: '13px', color: '#94a3b8' }}>Sort by:</span>
                <select 
                  className="sort-select"
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value)}
                >
                  <option value="created_at">Date Added</option>
                  <option value="filename">Filename</option>
                  <option value="file_size">File Size</option>
                </select>
                <select 
                  className="sort-select"
                  value={sortOrder}
                  onChange={(e) => setSortOrder(e.target.value)}
                >
                  <option value="desc">Descending</option>
                  <option value="asc">Ascending</option>
                </select>
              </div>
            </div>

            {/* Folder breadcrumbs */}
            {selectedFolderId !== null && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: '#94a3b8' }}>
                <span style={{ cursor: 'pointer' }} onClick={() => setSelectedFolderId(null)}>All Files</span>
                <ChevronRight size={14} />
                <span style={{ color: '#fff', fontWeight: '500' }}>
                  {selectedFolderId === -1 
                    ? 'Root Folder' 
                    : folders.find(f => f.id === selectedFolderId)?.name || 'Folder'
                  }
                </span>
              </div>
            )}

            {files.length === 0 ? (
              <div className="empty-state">
                <HardDrive className="empty-state-icon" />
                <h3>No files found</h3>
                <p>Upload a file or organize them into folders to get started.</p>
              </div>
            ) : (
              <div className="files-grid">
                {files.map(file => (
                  <div key={file.id} className="file-card">
                    <div className="file-preview-area">
                      {getFileThumbnailIcon(file)}
                      <div className={`file-visibility-badge ${file.is_public ? 'public' : 'private'}`}>
                        {file.is_public ? (
                          <>
                            <Globe size={10} /> Public
                          </>
                        ) : (
                          <>
                            <Lock size={10} /> Private
                          </>
                        )}
                      </div>
                    </div>

                    <div className="file-card-info">
                      <div className="file-card-name" title={file.filename}>
                        {file.filename}
                      </div>
                      <div className="file-card-meta">
                        <span>{formatBytes(file.file_size)}</span>
                        <span>{new Date(file.created_at).toLocaleDateString()}</span>
                      </div>
                    </div>

                    <div className="file-card-actions">
                      <div className="file-actions-left">
                        {file.is_public ? (
                          <>
                            <button 
                              className="btn-icon-only btn-secondary" 
                              onClick={() => handleCopyLink(file.id)}
                              title="Copy Share Link"
                            >
                              <Link size={14} />
                            </button>
                            <a 
                              href={`${window.location.origin}/shared/${file.id}`}
                              target="_blank" 
                              rel="noreferrer"
                              className="btn btn-secondary btn-icon-only"
                              title="Preview Shared Page"
                              style={{ display: 'inline-flex' }}
                            >
                              <Eye size={14} />
                            </a>
                          </>
                        ) : (
                          <button 
                            className="btn-icon-only btn-secondary" 
                            disabled 
                            title="Make public to share"
                            style={{ opacity: 0.5, cursor: 'not-allowed' }}
                          >
                            <Link size={14} />
                          </button>
                        )}
                      </div>

                      <div className="action-dropdown-container">
                        <button 
                          className="btn-icon-only btn-secondary"
                          onClick={() => setActiveMenuId(activeMenuId === file.id ? null : file.id)}
                          title="Actions Menu"
                        >
                          <MoreVertical size={14} />
                        </button>

                        {activeMenuId === file.id && (
                          <div className="dropdown-menu">
                            {/* Download Action with Token Query Parameter for private files */}
                            <a 
                              href={`${API_URL}/files/${file.id}/download?token=${localStorage.getItem('token')}`}
                              download={file.filename}
                              className="dropdown-item"
                              onClick={() => setActiveMenuId(null)}
                            >
                              <Download size={14} />
                              <span>Download</span>
                            </a>

                            <button 
                              className="dropdown-item"
                              onClick={() => {
                                handleToggleVisibility(file.id, file.is_public);
                                setActiveMenuId(null);
                              }}
                            >
                              {file.is_public ? <Lock size={14} /> : <Globe size={14} />}
                              <span>Make {file.is_public ? 'Private' : 'Public'}</span>
                            </button>

                            <button 
                              className="dropdown-item"
                              onClick={() => {
                                setShowMoveModal(file);
                                setMoveDestFolderId(file.folder_id ? file.folder_id.toString() : 'root');
                                setActiveMenuId(null);
                              }}
                            >
                              <Move size={14} />
                              <span>Move to Folder</span>
                            </button>

                            <button 
                              className="dropdown-item danger"
                              onClick={() => {
                                setShowDeleteModal(file);
                                setActiveMenuId(null);
                              }}
                            >
                              <Trash2 size={14} />
                              <span>Delete File</span>
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Delete Confirmation Modal */}
      {showDeleteModal && (
        <div className="dialog-overlay">
          <div className="dialog-box">
            <div className="dialog-header">Delete File</div>
            <p style={{ color: '#94a3b8', fontSize: '14px', marginBottom: '20px' }}>
              Are you sure you want to delete <strong>{showDeleteModal.filename}</strong> permanently? This action cannot be undone.
            </p>
            <div className="dialog-buttons">
              <button type="button" className="btn btn-secondary" onClick={() => setShowDeleteModal(null)}>
                Cancel
              </button>
              <button type="button" className="btn btn-danger" onClick={confirmDeleteFile}>
                Delete File
              </button>
            </div>
          </div>
        </div>
      )}

      {/* New Folder Modal */}
      {showFolderModal && (
        <div className="dialog-overlay">
          <div className="dialog-box">
            <div className="dialog-header">Create New Folder</div>
            <form onSubmit={handleCreateFolder}>
              <div className="form-group">
                <label>Folder Name</label>
                <input 
                  type="text" 
                  placeholder="e.g. Invoices, Pictures..." 
                  value={newFolderName}
                  onChange={(e) => setNewFolderName(e.target.value)}
                  autoFocus
                  required
                />
              </div>
              <div className="dialog-buttons">
                <button type="button" className="btn btn-secondary" onClick={() => setShowFolderModal(false)}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary">
                  Create Folder
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Move File Modal */}
      {showMoveModal && (
        <div className="dialog-overlay">
          <div className="dialog-box">
            <div className="dialog-header">Move "{showMoveModal.filename}"</div>
            <form onSubmit={handleMoveFile}>
              <div className="form-group">
                <label>Select Destination Folder</label>
                <select 
                  value={moveDestFolderId} 
                  onChange={(e) => setMoveDestFolderId(e.target.value)}
                >
                  <option value="root">Root Folder (No Folder)</option>
                  {folders.map(f => (
                    <option key={f.id} value={f.id}>{f.name}</option>
                  ))}
                </select>
              </div>
              <div className="dialog-buttons">
                <button type="button" className="btn btn-secondary" onClick={() => setShowMoveModal(null)}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary">
                  Move File
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Drag & Drop File Upload Modal */}
      {showUploadModal && (
        <div className="dialog-overlay">
          <div className="dialog-box" style={{ maxWidth: '480px' }}>
            <div className="upload-modal-header">
              <h3 style={{ fontSize: '18px', fontWeight: '600' }}>Upload Files</h3>
              <button 
                type="button" 
                onClick={() => setShowUploadModal(false)}
                style={{ padding: '4px', border: 'none', background: 'none', color: '#64748b' }}
              >
                <X size={20} />
              </button>
            </div>
            
            <div 
              className={`drop-zone ${dragActive ? 'active' : ''}`}
              onDragEnter={handleDrag}
              onDragOver={handleDrag}
              onDragLeave={handleDrag}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload className="drop-zone-icon" />
              <h3>Drag and drop your file here</h3>
              <p>or click to browse from device</p>
              <span style={{ fontSize: '11px', color: '#64748b' }}>Maximum file size: 100 MB</span>
              <input 
                ref={fileInputRef}
                type="file" 
                className="file-input"
                onChange={(e) => handleUploadFiles(e.target.files)}
                multiple
              />
            </div>
          </div>
        </div>
      )}

      {/* Upload queue status indicator widget (bottom-right) */}
      {uploads.length > 0 && (
        <div className="upload-queue-panel">
          <div className="upload-queue-header">
            <h4>
              <Upload size={16} /> 
              Upload Status ({uploads.filter(u => u.status === 'uploading').length} active)
            </h4>
            <button 
              type="button" 
              onClick={() => setUploads([])} 
              style={{ border: 'none', background: 'none', padding: '2px', color: '#94a3b8' }}
              title="Clear Queue"
            >
              <X size={16} />
            </button>
          </div>
          <div className="upload-queue-list">
            {uploads.map(item => (
              <div key={item.id} className="upload-item">
                <div className="upload-item-header">
                  <span className="upload-item-name" title={item.name}>{item.name}</span>
                  <span className="upload-item-progress-text">{item.progress}%</span>
                </div>
                
                {item.status === 'uploading' && (
                  <div className="upload-item-bar-bg">
                    <div className="upload-item-bar-fill" style={{ width: `${item.progress}%` }}></div>
                  </div>
                )}
                
                <div className={`upload-item-status ${item.status}`}>
                  {item.status === 'uploading' && (
                    <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <span className="spinner" style={{ display: 'inline-block', width: '8px', height: '8px', border: '1.5px solid currentColor', borderRightColor: 'transparent', borderRadius: '50%', animation: 'fadeIn 1s linear infinite' }}></span>
                      Uploading...
                    </span>
                  )}
                  {item.status === 'success' && (
                    <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <Check size={12} /> Uploaded successfully
                    </span>
                  )}
                  {item.status === 'error' && (
                    <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <AlertTriangle size={12} /> {item.error}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
