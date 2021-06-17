/*
 * Copyright 2021 EPAM Systems, Inc. (https://www.epam.com/)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { connect } from 'react-redux';

import StoreActionType from '../../store/ActionTypes';

import UiSettings from '../Tollbars/UiMain';
import UiOpenMenu from '../OpenFile/UiOpenMenu';
import UiViewMode from '../Tollbars/UiViewMode';
import UiFilterMenu from '../UiFilterMenu';
import UiModalText from '../UiModalText';
import UiModalAlert from '../Modals/ModalAlert';
import UiErrConsole from '../UiErrConsole';
import ModeView from '../../store/ModeView';
import Graphics2d from "../../engine/Graphics2d";
import UiCtrl2d from "../UiCtrl2d";

import BrowserDetector from '../../engine/utils/BrowserDetector';
import ExploreTools from "../Tollbars/ExploreTools";
import UIProgressBar from "../ProgressBar/UIProgressBar";
import UiAbout from "../UiAbout";

import css from "./UiApp.module.css";
import Graphics3d from "../../engine/Graphics3d";
import ZoomTools from "../ZoomTools";

class UiApp extends React.Component {
  constructor(props) {
    super(props);
    
    this.m_store = null;
    this.m_fileNameOnLoad = '';
    
    this.state = {
      strAlertTitle: '???',
      strAlertText: '???',
    };
    
  }
  
  UNSAFE_componentWillMount() {
    let fileNameOnLoad = '';
    const strSearch = window.location.search;
    if (strSearch.length > 0) {
      const strReg = /\\?url=(\S+)/;
      const arr = strSearch.match(strReg);
      if (arr === null) {
        console.log('arguments should be in form: ?url=www.xxx.yy/zz/ww');
        return;
      }
      fileNameOnLoad = arr[1];
      const regA = /^((ftp|http|https):\/\/)?(([\S]+)\.)?([\S]+)\.([A-z]{2,})(:\d{1,6})?\/[\S]+/;
      const regB = /(ftp|http|https):\/\/([\d]+)\.([\d]+)\.([\d]+)\.([\d]+)(:([\d]+))?\/([\S]+)/;
      const isValidA = fileNameOnLoad.match(regA);
      const isValidB = fileNameOnLoad.match(regB);
      if ((isValidA === null) && (isValidB === null)) {
        console.log(`Not valid URL = ${fileNameOnLoad}`);
        return;
      }
      this.m_fileNameOnLoad = fileNameOnLoad;
    }
  }
  
  componentDidMount() {
    const store = this.m_store;
    store.dispatch({ type: StoreActionType.SET_PROGRESS, progress: 0 });
    
    // browser detector
    const browserDetector = new BrowserDetector();
    this.isWebGl20supported = browserDetector.checkWebGlSupported();
    if (!this.isWebGl20supported) {
      this.setState({ strAlertTitle: 'Browser compatibility problem detected' });
      this.setState({ strAlertText: 'This browser not supported WebGL 2.0. Application functinality is decreased and app can be unstable' });
      store.dispatch({ type: StoreActionType.SET_MODAL_TEXT, showModalText: true })
    } else {
      const isValidBro = browserDetector.checkValidBrowser();
      if (!isValidBro) {
        this.setState({ strAlertTitle: 'Browser compatibility problem detected' });
        this.setState({ strAlertText: 'App is specially designed for Chrome/Firefox/Opera/Safari browsers' });
        store.dispatch({ type: StoreActionType.SET_MODAL_TEXT, showModalText: true })
      }
    }
  }
  
  onShowModalText() {
    this.props.dispatch({ type: StoreActionType.SET_MODAL_TEXT, showModalText: true })
  }
  
  onHideModalText() {
    this.props.dispatch({ type: StoreActionType.SET_MODAL_TEXT, showModalText: false })
  }
  
  onShowModalAlert() {
    this.props.dispatch({ type: StoreActionType.SET_MODAL_ALERT, showModalAlert: true })
  }
  
  onHideModalAlert() {
    this.props.dispatch({ type: StoreActionType.SET_MODAL_ALERT, showModalAlert: false })
  }
  
  /**
   * Main component render func callback
   */
  render() {
    const store = this.props;
    this.m_store = store;
    const arrErrorsLoadedd = store.arrErrors;
    
    const isReady = store.isLoaded && this.isWebGl20supported
    
    return (
      <>
          {this.props.progress > 0 && (
            <UIProgressBar
              active={this.props.progress}
              progress={this.props.progress}
            />)}
          <div className={css.header}>
            <UiAbout />
            <UiOpenMenu fileNameOnLoad={this.m_fileNameOnLoad}/>
          </div>
          {isReady && (<>
              <div className={css.left}>
                <UiViewMode/>
                {(store.modeView === ModeView.VIEW_2D) && <UiCtrl2d/>}
              </div>
              <div className={css.top}>
                <ExploreTools/>
              </div>
              <div className={css.center}>
                {ModeView.VIEW_2D === store.modeView ? <Graphics2d/> : <Graphics3d/>}
              </div>
              <div className={css.bottleft}>
                <ZoomTools/>
              </div>
              <div className={css.segmentation}>
                {store.modeView === ModeView.VIEW_2D && <UiFilterMenu/>}
                <UiSettings/>
              </div>
            </>
          )}
        
        {arrErrorsLoadedd.length > 0 && <UiErrConsole/>}
        
        <UiModalText stateVis={this.props.showModalText}
                     onHide={this.onHideModalText.bind(this)}
                     onShow={this.onShowModalText.bind(this)}/>
        
        <UiModalAlert stateVis={this.props.showModalAlert}
                      onHide={this.onHideModalAlert.bind(this)}
                      onShow={this.onShowModalAlert.bind(this)}
                      title={this.props.strAlertTitle}
                      text={this.props.strAlertText}/>
      </>
    );
  }
  
}

export default connect(store => store)(UiApp);
