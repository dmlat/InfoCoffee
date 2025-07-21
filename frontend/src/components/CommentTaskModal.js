import React, { useState } from 'react';
import './CommentTaskModal.css';
import '../styles/auth.css'; // For .form-group etc.

export default function CommentTaskModal({ isOpen, onClose, onSave }) {
    const [comment, setComment] = useState('');

    if (!isOpen) {
        return null;
    }
    
    const handleSend = () => {
        onSave(comment);
        setComment(''); // Clear comment after sending
    };

    return (
        <div className="modal-overlay">
            <div className="comment-task-modal-content">
                <div className="modal-header">
                    <h2>Хотите отправить дополнительное сообщение исполнителю?</h2>
                    <button onClick={onClose} className="close-btn">&times;</button>
                </div>
                
                <div className="modal-body">
                    <div className="form-group">
                        <textarea
                            id="task-comment"
                            rows="4"
                            value={comment}
                            onChange={(e) => setComment(e.target.value)}
                            placeholder="Например: 'Пополни только кофе, возьми со склада...'"
                        ></textarea>
                    </div>
                </div>

                <div className="modal-footer">
                    <button className="action-btn" onClick={handleSend}>Отправить</button>
                </div>
            </div>
        </div>
    );
} 