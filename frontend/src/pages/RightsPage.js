// frontend/src/pages/RightsPage.js
import React, { useState, useEffect, useCallback } from 'react';
import apiClient from '../api';
import ConfirmModal from '../components/ConfirmModal';
import './RightsPage.css';
import '../styles/tables.css';

export default function RightsPage({ user }) {
    const [accessList, setAccessList] = useState([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState('');
    
    // Состояние для формы добавления
    const [newTelegramId, setNewTelegramId] = useState('');
    const [newUserName, setNewUserName] = useState('');
    const [isAdding, setIsAdding] = useState(false);
    const [addError, setAddError] = useState('');

    // Состояние для модальных окон
    const [modalState, setModalState] = useState({
        isOpen: false,
        message: '',
        onConfirm: () => {},
        confirmText: 'Да',
    });

    // const currentUserTelegramId = localStorage.getItem('telegramId'); // Not used, can be removed.

    const fetchAccessList = useCallback(async () => {
        setIsLoading(true);
        setError('');
        try {
            const response = await apiClient.get('/access');
            if (response.data.success) {
                setAccessList(response.data.accessList || []);
            } else {
                setError(response.data.error || 'Не удалось загрузить список доступов.');
            }
        } catch (err) {
            setError(err.response?.data?.error || 'Ошибка сети при загрузке доступов.');
        } finally {
            setIsLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchAccessList();
    }, [fetchAccessList]);

    const handleAddUser = async (e) => {
        e.preventDefault();
        if (!newTelegramId.trim() || !newUserName.trim()) {
            setAddError('Пожалуйста, заполните Telegram ID и Имя пользователя.');
            return;
        }
        if (!/^\d+$/.test(newTelegramId.trim())) {
            setAddError('Telegram ID должен содержать только цифры.');
            return;
        }

        setIsAdding(true);
        setAddError('');

        try {
            const response = await apiClient.post('/access', {
                shared_with_telegram_id: newTelegramId.trim(),
                shared_with_name: newUserName.trim(),
                access_level: 'admin', // По умолчанию добавляем как админа
            });
            if (response.data.success && response.data.access) {
                setAccessList(prev => [response.data.access, ...prev]);
                setNewTelegramId('');
                setNewUserName('');
            } else {
                setAddError(response.data.error || 'Не удалось добавить пользователя.');
            }
        } catch (err) {
            setAddError(err.response?.data?.error || 'Ошибка сети при добавлении пользователя.');
        } finally {
            setIsAdding(false);
        }
    };
    
    const handleUpdateAccess = async (accessId, newLevel) => {
        try {
            const response = await apiClient.put(`/access/${accessId}`, { access_level: newLevel });
            if (response.data.success) {
                setAccessList(prev => prev.map(item => 
                    item.id === accessId ? { ...item, access_level: newLevel } : item
                ));
            } else {
                setError(response.data.error || "Ошибка обновления прав");
            }
        } catch (err) {
             setError(err.response?.data?.error || "Ошибка сети при обновлении прав");
        } finally {
            setModalState({ isOpen: false });
        }
    };

    const handleDeleteAccess = async (accessId) => {
        try {
            const response = await apiClient.delete(`/access/${accessId}`);
            if (response.data.success) {
                setAccessList(prev => prev.filter(item => item.id !== accessId));
            } else {
                setError(response.data.error || "Ошибка удаления доступа");
            }
        } catch (err) {
            setError(err.response?.data?.error || "Ошибка сети при удалении доступа");
        } finally {
            setModalState({ isOpen: false });
        }
    };
    
    const openConfirmationModal = (action, ...args) => {
        const [id, value] = args;
        let message = '';
        let onConfirm = () => {};

        if (action === 'delete') {
            message = 'Вы уверены, что хотите отозвать доступ для этого пользователя?';
            onConfirm = () => handleDeleteAccess(id);
        } else if (action === 'updateAccess') {
            message = `Вы уверены, что хотите изменить уровень доступа на "${value === 'admin' ? 'Админ' : 'Обслуживание'}"?`;
            onConfirm = () => handleUpdateAccess(id, value);
        }

        setModalState({ isOpen: true, message, onConfirm, confirmText: 'Да' });
    };

    return (
        <>
            <ConfirmModal 
                isOpen={modalState.isOpen}
                message={modalState.message}
                onConfirm={modalState.onConfirm}
                onCancel={() => setModalState({ isOpen: false })}
                confirmText={modalState.confirmText}
            />
            <div className="page-container rights-page-layout">
                <div className="main-content-area">
                    <div className="access-form-container">
                        <h2 className="form-title">Предоставить доступ</h2>
                         <p className="form-sub-title">Введите Telegram ID и имя пользователя.</p>
                        <form onSubmit={handleAddUser} className="access-form">
                            <div className="form-row">
                                <input
                                    type="text"
                                    value={newTelegramId}
                                    onChange={(e) => setNewTelegramId(e.target.value.replace(/\D/g, ''))}
                                    placeholder="Telegram ID"
                                    className="form-input"
                                />
                                <input
                                    type="text"
                                    value={newUserName}
                                    onChange={(e) => setNewUserName(e.target.value)}
                                    placeholder="Имя пользователя"
                                    className="form-input"
                                />
                                <button type="submit" className="rights-form-add-button" disabled={isAdding || !newTelegramId || !newUserName}>
                                    {isAdding ? '...' : 'Добавить'}
                                </button>
                            </div>
                            {addError && <p className="form-error">{addError}</p>}
                        </form>
                        <small className="form-hint">
                            Чтобы получить Telegram ID, пользователю нужно:
                            <br/>- Зайти в нашего бота и нажать "Мой Telegram ID" в меню.
                            <br/>- Или отправить боту команду <code>/myid</code>.
                        </small>
                    </div>

                    {error && <p className="error-message">{error}</p>}
                    {isLoading ? (
                        <p className="page-loading-container">Загрузка списка доступов...</p>
                    ) : (
                        <div className="data-table-container">
                            <table className="data-table">
                                <thead>
                                    <tr>
                                        <th>Имя</th>
                                        <th>ID</th>
                                        <th className="access-level-header">Доступ</th>
                                        <th className="td-action"></th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {accessList.length === 0 ? (
                                        <tr className="empty-data-row">
                                            <td colSpan="4">Вы еще никому не предоставили доступ.</td>
                                        </tr>
                                    ) : (
                                        accessList.map(item => (
                                            <tr key={item.id}>
                                                <td>{item.shared_with_name}</td>
                                                <td>{String(item.shared_with_telegram_id)}</td>
                                                <td>
                                                  {item.is_self ? (
                                                      <span className="your-access-label">{item.access_level === 'admin' ? 'Админ (это вы)' : 'Обслуживание (это вы)'}</span>
                                                  ) : (
                                                    <div className="access-buttons">
                                                        <button 
                                                            className={`access-btn ${item.access_level === 'admin' ? 'active' : ''}`}
                                                            onClick={() => openConfirmationModal('updateAccess', item.id, 'admin')}>
                                                            Админ
                                                        </button>
                                                        <button 
                                                            className={`access-btn ${item.access_level === 'service' ? 'active' : ''}`}
                                                            onClick={() => openConfirmationModal('updateAccess', item.id, 'service')}>
                                                            Сервис
                                                        </button>
                                                    </div>
                                                  )}
                                                </td>
                                                <td className="td-action">
                                                    {!item.is_self && (
                                                        <button onClick={() => openConfirmationModal('delete', item.id)} className="delete-btn" title="Отозвать доступ">
                                                            &times;
                                                        </button>
                                                    )}
                                                </td>
                                            </tr>
                                        ))
                                    )}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>
            </div>
        </>
    );
}