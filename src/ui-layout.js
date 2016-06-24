'use strict';

/**
 * UI.Layout
 */
angular.module('ui.layout', [])
  .controller('uiLayoutCtrl', ['$scope', '$attrs', '$element', '$timeout', '$window', 'LayoutContainer',
  function uiLayoutCtrl($scope, $attrs, $element, $timeout, $window, LayoutContainer) {

    var ctrl = this;
    var opts = angular.extend({}, $scope.$eval($attrs.uiLayout), $scope.$eval($attrs.options));
    var numOfSplitbars = 0;
    //var cache = {};
    var animationFrameRequested;
    var lastPos;

    // regex to verify size is properly set to pixels or percent
    var sizePattern = /\d+\s*(px|%)\s*$/i;

    if ($attrs.layoutId) {
      ctrl.id = $attrs.layoutId;
    }

    ctrl.animate = $attrs.animate;

    ctrl.containers = [];
    ctrl.movingSplitbar = null;
    ctrl.bounds = $element[0].getBoundingClientRect();
    ctrl.isUsingColumnFlow = opts.flow === 'column';
    ctrl.sizeProperties = !ctrl.isUsingColumnFlow ?
    { sizeProperty: 'height',
      offsetSize: 'offsetHeight',
      offsetPos: 'top',
      flowProperty: 'top',
      oppositeFlowProperty: 'bottom',
      mouseProperty: 'clientY',
      flowPropertyPosition: 'y' } :
    { sizeProperty: 'width',
      offsetSize: 'offsetWidth',
      offsetPos: 'left',
      flowProperty: 'left',
      oppositeFlowProperty: 'right',
      mouseProperty: 'clientX',
      flowPropertyPosition: 'x' };

    $scope.$watch($window.getComputedStyle($element[0], null).direction, function() {
      ctrl.dir = $window.getComputedStyle($element[0], null).direction;
      if (ctrl.isUsingColumnFlow) {
        ctrl.sizeProperties.flowProperty = ctrl.sizeProperties.offsetPos = (ctrl.dir === 'rtl') ? 'right' : 'left';
        ctrl.calculate();
      }
    });

    $element
      // Force the layout to fill the parent space
      // fix no height layout...
      .addClass('stretch')
      // set the layout css class
      .addClass('ui-layout-' + (opts.flow || 'row'));

    if (opts.disableToggle) {
      $element.addClass('no-toggle');
    }
    if (opts.disableMobileToggle) {
      $element.addClass('no-mobile-toggle');
    }
    if (!opts.showHandle) {
      $element.addClass('no-handle');
    }

    // Initial global size definition
    opts.sizes = opts.sizes || [];
    opts.maxSizes = opts.maxSizes || [];
    opts.minSizes = opts.minSizes || [];
    opts.dividerSize = opts.dividerSize === undefined ? 10 : opts.dividerSize;
    opts.collapsed = opts.collapsed || [];
    ctrl.opts = opts;

    $scope.updateDisplay = function() {
      ctrl.calculate();
    };

    var debounceEvent;
    function draw() {
      var dividerSize = parseInt(opts.dividerSize);
      var elementSize = $element[0][ctrl.sizeProperties.offsetSize];

      if(ctrl.movingSplitbar !== null) {
        var splitbarIndex = ctrl.containers.indexOf(ctrl.movingSplitbar);
        var nextSplitbarIndex = (splitbarIndex + 2) < ctrl.containers.length ? splitbarIndex + 2 : null;

        if(splitbarIndex > -1) {
          var processedContainers = ctrl.processSplitbar(ctrl.containers[splitbarIndex]);
          var beforeContainer = processedContainers.beforeContainer;
          var afterContainer = processedContainers.afterContainer;

          if(!beforeContainer.collapsed && !afterContainer.collapsed) {
            // calculate container positons
            var difference = ctrl.movingSplitbar.position - lastPos;
            var newPosition = ctrl.movingSplitbar.position - difference;

            // Keep the bar in the window (no left/top 100%)
            newPosition = Math.min(elementSize-dividerSize, newPosition);

            // Keep the bar from going past the previous element min/max values
            if(angular.isNumber(beforeContainer.beforeMinValue) && newPosition < beforeContainer.beforeMinValue)
              newPosition = beforeContainer.beforeMinValue;
            if(angular.isNumber(beforeContainer.beforeMaxValue) && newPosition > beforeContainer.beforeMaxValue)
              newPosition = beforeContainer.beforeMaxValue;

            // Keep the bar from going past the next element min/max values
            if(afterContainer !== null &&
              angular.isNumber(afterContainer.afterMinValue) &&
              newPosition > (afterContainer.afterMinValue - dividerSize))
              newPosition = afterContainer.afterMinValue - dividerSize;
            if(afterContainer !== null && angular.isNumber(afterContainer.afterMaxValue) && newPosition < afterContainer.afterMaxValue)
              newPosition = afterContainer.afterMaxValue;

            // resize the before container
            beforeContainer.size = newPosition - beforeContainer.position;
            // store the current value to preserve this size during onResize
            beforeContainer.uncollapsedSize = beforeContainer.size;

            // update after container position
            var oldAfterContainerPosition = afterContainer.position;
            afterContainer.position = newPosition + dividerSize;

            //update after container size if the position has changed
            if(afterContainer.position != oldAfterContainerPosition) {
              afterContainer.size = (nextSplitbarIndex !== null) ?
              (oldAfterContainerPosition + afterContainer.size) - (newPosition + dividerSize) :
              elementSize - (newPosition + dividerSize);
              // store the current value to preserve this size during onResize
              afterContainer.uncollapsedSize = afterContainer.size;
            }

            // store the current value in local storage to preserve size also when reloading the window
            if($window.localStorage !== undefined) {
              $window.localStorage.setItem(beforeContainer.storageId, beforeContainer.uncollapsedSize + 'px');
              $window.localStorage.setItem(afterContainer.storageId, afterContainer.uncollapsedSize + 'px');
            }

            // move the splitbar
            ctrl.movingSplitbar.position = newPosition;

            ctrl.movingSplitbar.updatePosition();
            beforeContainer.update();
            afterContainer.update();

            // broadcast an event that resize happened (debounced to 50ms)
            if(debounceEvent) $timeout.cancel(debounceEvent);
            debounceEvent = $timeout(function() {
              $scope.$digest();
              debounceEvent = null;
            }, 50, false);
          }
        }
      }

      //Enable a new animation frame
      animationFrameRequested = null;
    }

    function offset(element) {
      var rawDomNode = element[0];
      var body = document.documentElement || document.body;
      var scrollX = window.pageXOffset || body.scrollLeft;
      var scrollY = window.pageYOffset || body.scrollTop;
      var clientRect = rawDomNode.getBoundingClientRect();
      if (ctrl.isUsingColumnFlow) {
        return clientRect[ctrl.sizeProperties.offsetPos] + scrollX;
      } else {
        return clientRect[ctrl.sizeProperties.offsetPos] + scrollY;
      }
    }

    /**
     * Returns the current value for an option
     * @param  option   The option to get the value for
     * @return The value of the option. Returns null if there was no option set.
     */
    function optionValue(option) {
      if(typeof option == 'number' || typeof option == 'string' && option.match(sizePattern)) {
        return option;
      } else {
        return null;
      }
    }

    /**
     * Updates the storage ids of all containers according to the id of this controller and the index of the container.
     */
     function updateContainerStorageIds() {
      for (var i = 0; i < ctrl.containers.length; ++i) {
        var c = ctrl.containers[i];
        c.storageId = ctrl.id + ':' + i;
      }
    }

    //================================================================================
    // Public Controller Functions
    //================================================================================
    ctrl.mouseUpHandler = function(event) {
      if(ctrl.movingSplitbar !== null) {
        ctrl.movingSplitbar = null;
      }
      return event;
    };

    ctrl.mouseMoveHandler = function(mouseEvent) {
      var mousePos = mouseEvent[ctrl.sizeProperties.mouseProperty] ||
        (mouseEvent.originalEvent && mouseEvent.originalEvent[ctrl.sizeProperties.mouseProperty]) ||
        // jQuery does touches weird, see #82
        ($window.jQuery ?
          (mouseEvent.originalEvent ? mouseEvent.originalEvent.targetTouches[0][ctrl.sizeProperties.mouseProperty] : 0) :
          (mouseEvent.targetTouches ? mouseEvent.targetTouches[0][ctrl.sizeProperties.mouseProperty] : 0));

      if (ctrl.dir === 'rtl' && ctrl.isUsingColumnFlow) {
        lastPos = offset($element) - mousePos;
      } else {
        lastPos = mousePos - offset($element);
      }


      //Cancel previous rAF call
      if(animationFrameRequested) {
        window.cancelAnimationFrame(animationFrameRequested);
      }

      //TODO: cache layout values

      //Animate the page outside the event
      animationFrameRequested = window.requestAnimationFrame(draw);
    };

    /**
     * Returns the min and max values of the ctrl.containers on each side of the container submitted
     * @param container
     * @returns {*}
     */
    ctrl.processSplitbar = function(container) {
      var index = ctrl.containers.indexOf(container);

      var setValues = function(container) {
        var start = container.position;
        var end = container.position + container.size;

        container.beforeMinValue = angular.isNumber(container.minSize) ? start + container.minSize : start;
        container.beforeMaxValue = angular.isNumber(container.maxSize) ? start + container.maxSize : null;

        container.afterMinValue = angular.isNumber(container.minSize) ? end - container.minSize : end;
        container.afterMaxValue = angular.isNumber(container.maxSize) ? end - container.maxSize : null;
      };

      //verify the container was found in the list
      if(index > -1) {
        var beforeContainer = (index > 0) ? ctrl.containers[index-1] : null;
        var afterContainer = ((index+1) <= ctrl.containers.length) ? ctrl.containers[index+1] : null;

        if(beforeContainer !== null) setValues(beforeContainer);
        if(afterContainer !== null) setValues(afterContainer);

        return {
          beforeContainer: beforeContainer,
          afterContainer: afterContainer
        };
      }

      return null;
    };

    /**
     * Checks if a string has a percent symbol in it.
     * @param num
     * @returns {boolean}
     */
    ctrl.isPercent = function(num) {
      return (num && angular.isString(num) && num.indexOf('%') > -1) ? true : false;
    };

    /**
     * Converts a number to pixels from percent.
     * @param size
     * @param parentSize
     * @returns {number}
     */
    ctrl.convertToPixels = function(size, parentSize) {
      return Math.floor(parentSize * (parseInt(size) / 100));
    };

    /**
     * Sets the default size and position (left, top) for each container.
     */
    ctrl.calculate = function() {
      var c, i;
      var dividerSize = parseInt(opts.dividerSize);
      var elementSize = $element[0].getBoundingClientRect()[ctrl.sizeProperties.sizeProperty];
      var numOfVisibleSplitbars = numOfSplitbars;
      if (opts.hideCollapsedSplitbar) {
        numOfVisibleSplitbars = ctrl.containers.filter(function(c) {
          return LayoutContainer.isSplitbar(c) && !c.collapsed;
        }).length;
      }
      var availableSize = elementSize - (dividerSize * numOfVisibleSplitbars);
      var originalSize = availableSize;
      var usedSpace = 0;
      var numOfAutoContainers = 0;
      var sumMin = 0;
      var sumMax = 0;
      if(ctrl.containers.length > 0 && $element.children().length > 0) {

        // calculate sizing for ctrl.containers
        for(i=0; i < ctrl.containers.length; i++) {
          if(!LayoutContainer.isSplitbar(ctrl.containers[i])) {

            c = ctrl.containers[i];
            opts.sizes[i] = c.collapsed ? (opts.hideCollapsedContainer ? '0px' : (optionValue(c.minSize) || '0px')) : c.isCentral ? 'auto' : optionValue(c.uncollapsedSize) || 'auto';
            opts.minSizes[i] = optionValue(c.minSize);
            opts.maxSizes[i] = optionValue(c.maxSize);

            if(opts.sizes[i] !== 'auto') {
              if(ctrl.isPercent(opts.sizes[i])) {
                opts.sizes[i] = ctrl.convertToPixels(opts.sizes[i], originalSize);
              } else {
                opts.sizes[i] = parseInt(opts.sizes[i]);
              }
            }

            if(opts.minSizes[i] !== null) {
              if(ctrl.isPercent(opts.minSizes[i])) {
                opts.minSizes[i] = ctrl.convertToPixels(opts.minSizes[i], originalSize);
              } else {
                opts.minSizes[i] = parseInt(opts.minSizes[i]);
              }

              // don't allow the container size to initialize smaller than the minSize
              if(!c.collapsed && opts.sizes[i] < opts.minSizes[i]) opts.sizes[i] = opts.minSizes[i];
            }

            if(opts.maxSizes[i] !== null) {
              if(ctrl.isPercent(opts.maxSizes[i])) {
                opts.maxSizes[i] = ctrl.convertToPixels(opts.maxSizes[i], originalSize);
              } else {
                opts.maxSizes[i] = parseInt(opts.maxSizes[i]);
              }

              // don't allow the container size to intialize larger than the maxSize
              if(opts.sizes[i] > opts.maxSizes[i]) opts.sizes[i] = opts.maxSizes[i];
            }

            if(opts.sizes[i] === 'auto') {
              numOfAutoContainers++;
              sumMin += (opts.minSizes[i] || 0);
            } else {
              availableSize -= opts.sizes[i];
            }
          }
        }

        // FIXME: autoSize if frequently Infinity, since numOfAutoContainers is frequently 0, no need to calculate that
        // set the sizing for the ctrl.containers
        /*
         * When the parent size is odd, rounding down the `autoSize` leaves a remainder.
         * This remainder is added to the last auto-sized container in a layout.
         */
        var autoSize = Math.floor(availableSize / numOfAutoContainers),
          remainder = availableSize - autoSize * numOfAutoContainers;
        
        var autoSizeAfterMin = Math.floor(Math.max(availableSize - sumMin, 0) / numOfAutoContainers);
        remainder = availableSize - autoSizeAfterMin * numOfAutoContainers + sumMin;

        

        var availableAfterMax = 0;
        var numOfGreaterMax = 0;
        for(i=0; i < ctrl.containers.length; i++) {
          if(opts.sizes[i] === 'auto') {
            if (opts.maxSizes[i] && opts.maxSizes[i] < autoSizeAfterMin + (opts.minSizes[i] || 0)) {
              availableAfterMax += autoSizeAfterMin - opts.maxSizes[i];
            } else {
              numOfGreaterMax++;
            }
          }
        }

        var autoSizeAfterMax = Math.floor(availableAfterMax / numOfGreaterMax);

        for(i=0; i < ctrl.containers.length; i++) {
          c = ctrl.containers[i];
          c.position = usedSpace;
          c.maxSize = opts.maxSizes[i];
          c.minSize = opts.minSizes[i];

          //TODO: adjust size if autosize is greater than the maxSize

          if(!LayoutContainer.isSplitbar(c)) {
            var newSize;

            var autoSize = (opts.maxSizes[i] && opts.maxSizes[i] < autoSizeAfterMin + (opts.minSizes[i] || 0)) ?
              opts.maxSizes[i] :
              (opts.minSizes[i] || 0) + autoSizeAfterMin + autoSizeAfterMax;

            if(opts.sizes[i] === 'auto') {
              // add the rounding down remainder to the last auto-sized container in the layout
              if (i === ctrl.containers.length - 1) {
                newSize = originalSize - usedSpace;
              } else {
                newSize = autoSize
                availableSize -= c.size;
              }
            } else {
              newSize = opts.sizes[i];
            }

            newSize = (newSize !== null) ? newSize : autoSize;
            if (c.size !== newSize) {
              c.size = newSize;
            }
          } else {
            c.size = (c.collapsed && opts.hideCollapsedSplitbar) ? 0 : dividerSize;
          }

          usedSpace += c.size;
        }
      }
    };

    /**
     * Adds a container to the list of layout ctrl.containers.
     * @param container The container to add
     */
    ctrl.addContainer = function(container) {
      var index = ctrl.indexOfElement(container.element);
      if(!angular.isDefined(index) || index < 0 || ctrl.containers.length < index) {
        console.error("Invalid index to add container; i=" + index + ", len=", ctrl.containers.length);
        return;
      }

      if(LayoutContainer.isSplitbar(container)) {
        numOfSplitbars++;
      }

      container.index = index;
      ctrl.containers.splice(index, 0, container);

      updateContainerStorageIds();

      ctrl.calculate();
    };

    /**
     * Remove a container from the list of layout ctrl.containers.
     * @param  container
     */
    ctrl.removeContainer = function(container) {
      var index = ctrl.containers.indexOf(container);
      if(index >= 0) {
        if(!LayoutContainer.isSplitbar(container)) {
          if(ctrl.containers.length > 2) {
            // Assume there's a sidebar between each container
            // We need to remove this container and the sidebar next to it
            if(index == ctrl.containers.length - 1) {
              // We're removing the last element, the side bar is on the left
              ctrl.containers[index-1].element.remove();
            } else {
              // The side bar is on the right
              ctrl.containers[index+1].element.remove();
            }
          }
        } else {
          // fix for potentially collapsed containers
          ctrl.containers[index - 1].collapsed = false;
          numOfSplitbars--;
        }

        // Need to re-check the index, as a side bar may have been removed
        var newIndex = ctrl.containers.indexOf(container);
        if(newIndex >= 0) {
          ctrl.containers.splice(newIndex, 1);
          ctrl.opts.maxSizes.splice(newIndex, 1);
          ctrl.opts.minSizes.splice(newIndex, 1);
          ctrl.opts.sizes.splice(newIndex, 1);
        }
        updateContainerStorageIds();
        ctrl.calculate();
      } else {
        console.error("removeContainer for container that did not exist!");
      }
    };

    /**
     * Returns an array of layout ctrl.containers.
     * @returns {Array}
     */
    ctrl.getContainers = function() {
      return ctrl.containers;
    };

    ctrl.toggleContainer = function(index) {
      var c = ctrl.containers[index];
      c.collapsed = !ctrl.containers[index].collapsed;
      ctrl.processToggleContainer(index);
    };

    ctrl.processToggleContainer = function(index) {
      var c = ctrl.containers[index];

      $scope.$broadcast('ui.layout.toggle', c);

      var splitbarBefore = ctrl.containers[index - 1];
      var splitbarAfter = ctrl.containers[index + 1];

      if (splitbarBefore) {
        splitbarBefore.notifyToggleAfter(c.collapsed);
      }

      if (splitbarAfter) {
        splitbarAfter.notifyToggleBefore(c.collapsed);
      }

      $scope.$evalAsync(function() {
        ctrl.calculate();
      });

      return c.collapsed;
    };

    /**
     * Toggles the container before the provided splitbar
     * @param splitbar
     * @returns {boolean|*|Array}
     */
    ctrl.toggleBefore = function(splitbar) {
      var index = ctrl.containers.indexOf(splitbar) - 1;
      return ctrl.toggleContainer(index);
    };


    /**
     * Toggles the container after the provided splitbar
     * @param splitbar
     * @returns {boolean|*|Array}
     */
    ctrl.toggleAfter = function(splitbar) {
      var index = ctrl.containers.indexOf(splitbar) + 1;
      return ctrl.toggleContainer(index);
    };

    /**
     * Returns the container object of the splitbar that is before the one passed in.
     * @param currentSplitbar
     */
    ctrl.getPreviousSplitbarContainer = function(currentSplitbar) {
      if(LayoutContainer.isSplitbar(currentSplitbar)) {
        var currentSplitbarIndex = ctrl.containers.indexOf(currentSplitbar);
        var previousSplitbarIndex = currentSplitbarIndex - 2;
        if(previousSplitbarIndex >= 0) {
          return ctrl.containers[previousSplitbarIndex];
        }
        return null;
      }
      return null;
    };

    /**
     * Returns the container object of the splitbar that is after the one passed in.
     * @param currentSplitbar
     */
    ctrl.getNextSplitbarContainer = function(currentSplitbar) {
      if(LayoutContainer.isSplitbar(currentSplitbar)) {
        var currentSplitbarIndex = ctrl.containers.indexOf(currentSplitbar);
        var nextSplitbarIndex = currentSplitbarIndex + 2;
        if(currentSplitbarIndex > 0 && nextSplitbarIndex < ctrl.containers.length) {
          return ctrl.containers[nextSplitbarIndex];
        }
        return null;
      }
      return null;
    };

    /**
     * Checks whether the container before this one is a split bar
     * @param  {container}  container The container to check
     * @return {Boolean}    true if the element before is a splitbar, false otherwise
     */
    ctrl.hasSplitbarBefore = function(container) {
      var index = ctrl.containers.indexOf(container);
      if(1 <= index) {
        return LayoutContainer.isSplitbar(ctrl.containers[index-1]);
      }

      return false;
    };

    /**
     * Checks whether the container after this one is a split bar
     * @param  {container}  container The container to check
     * @return {Boolean}    true if the element after is a splitbar, false otherwise
     */
    ctrl.hasSplitbarAfter = function(container) {
      var index = ctrl.containers.indexOf(container);
      if(index < ctrl.containers.length - 1) {
        return LayoutContainer.isSplitbar(ctrl.containers[index+1]);
      }

      return false;
    };

    /**
     * Checks whether the passed in element is a ui-layout type element.
     * @param  {element}  element The element to check
     * @return {Boolean}          true if the element is a layout element, false otherwise.
     */
    ctrl.isLayoutElement = function(element) {
      return element.hasAttribute('ui-layout-container') ||
        element.hasAttribute('ui-splitbar') ||
        element.nodeName === 'UI-LAYOUT-CONTAINER';
    };

    /**
     * Retrieve the index of an element within it's parents context.
     * @param  {element} element The element to get the index of
     * @return {int}             The index of the element within it's parent
     */
    ctrl.indexOfElement = function(element) {
      var parent = element.parent();
      var children = parent.children();
      var containerIndex = 0;
      for(var i = 0; i < children.length; i++) {
        var child = children[i];
        if(ctrl.isLayoutElement(child)) {
          if(element[0] == children[i]) {
            return containerIndex;
          }
          containerIndex++;
        }
      }
      return -1;
    };

    return ctrl;
  }])

  .directive('uiLayout', ['$window', function($window) {
    return {
      restrict: 'AE',
      controller: 'uiLayoutCtrl',
      link: function(scope, element, attrs, ctrl) {
        scope.$watch(function () {
          return element[0][ctrl.sizeProperties.offsetSize];
        }, function() {
          ctrl.calculate();
        });

        scope.$watch(attrs.disableResize, function(disableResize) {
          ctrl.disableResize = disableResize;
        });

        function onResize() {
          ctrl.calculate();
          ctrl.containers.forEach(function(c) {
            c.update();
          });
        }

        angular.element($window).bind('resize', onResize);

        scope.$on('$destroy', function() {
          angular.element($window).unbind('resize', onResize);
        });
      }
    };
  }])

  .directive('uiSplitbar', ['LayoutContainer', function(LayoutContainer) {
    // Get all the page.
    var htmlElement = angular.element(document.body.parentElement);

    return {
      restrict: 'EAC',
      require: '^uiLayout',
      scope: {},

      link: function(scope, element, attrs, ctrl) {
        if(!element.hasClass('stretch')) element.addClass('stretch');
        if(!element.hasClass('ui-splitbar')) element.addClass('ui-splitbar');

        if (ctrl.animate === 'true') {
          var animationClass = ctrl.isUsingColumnFlow ? 'animate-column' : 'animate-row';
          element.addClass(animationClass);
        }

        scope.splitbar = LayoutContainer.Splitbar();
        scope.splitbar.element = element;

        //icon <a> elements
        var prevButton = angular.element(element.children()[0]);
        var afterButton = angular.element(element.children()[2]);

        //icon <span> elements
        var prevIcon = angular.element(prevButton.children()[0]);
        var afterIcon = angular.element(afterButton.children()[0]);

        //icon classes
        var iconLeft = 'ui-splitbar-icon-left';
        var iconRight = 'ui-splitbar-icon-right';
        var iconUp = 'ui-splitbar-icon-up';
        var iconDown = 'ui-splitbar-icon-down';

        var prevIconClass = ctrl.isUsingColumnFlow ? iconLeft : iconUp;
        var afterIconClass = ctrl.isUsingColumnFlow ? iconRight : iconDown;

        prevIcon.addClass(prevIconClass);
        afterIcon.addClass(afterIconClass);
        
        function getCollapse() {
          var before = ctrl.containers[index - 1];
          var after = ctrl.containers[index + 1];
          return (before !== undefined && before.collapsed) || (after !== undefined && after.collapsed);
        }

        scope.splitbar.notifyToggleBefore = function(isCollapsed) {
          scope.splitbar.collapsed = getCollapse();
          if(isCollapsed) {
            afterButton.css('display', 'none');

            if (ctrl.isUsingColumnFlow) {
              prevIcon.removeClass(iconLeft);
              prevIcon.addClass(iconRight);
            } else {
              prevIcon.removeClass(iconUp);
              prevIcon.addClass(iconDown);
            }
          } else {
            afterButton.css('display', 'inline');

            if (ctrl.isUsingColumnFlow) {
              prevIcon.removeClass(iconRight);
              prevIcon.addClass(iconLeft);
            } else {
              prevIcon.removeClass(iconDown);
              prevIcon.addClass(iconUp);
            }
          }
        };

        scope.splitbar.notifyToggleAfter = function(isCollapsed) {
          scope.splitbar.collapsed = getCollapse();
          if(isCollapsed) {
            prevButton.css('display', 'none');

            if(ctrl.isUsingColumnFlow) {
              afterIcon.removeClass(iconRight);
              afterIcon.addClass(iconLeft);
            } else {
              afterIcon.removeClass(iconDown);
              afterIcon.addClass(iconUp);
            }
          } else {
            prevButton.css('display', 'inline');

            if(ctrl.isUsingColumnFlow) {
              afterIcon.removeClass(iconLeft);
              afterIcon.addClass(iconRight);
            } else {
              afterIcon.removeClass(iconUp);
              afterIcon.addClass(iconDown);
            }
          }
        };

        prevButton.on('click', function() {
          ctrl.toggleBefore(scope.splitbar);
        });
        afterButton.on('click', function() {
          ctrl.toggleAfter(scope.splitbar);
        });

        element.on('mousedown touchstart', function(e) {
          if (e.button === 0 || e.type === 'touchstart') {
            // only trigger when left mouse button is pressed:
            ctrl.movingSplitbar = scope.splitbar;
            ctrl.processSplitbar(scope.splitbar);

            e.preventDefault();
            e.stopPropagation();

            htmlElement.on('mousemove touchmove', handleMouseMove);
            return false;
          }
        });

        function handleMouseMove(event) {
          if (!ctrl.disableResize) {
            ctrl.mouseMoveHandler(event);
          }
        }

        function handleMouseUp(event) {
          ctrl.mouseUpHandler(event);
          htmlElement.off('mousemove touchmove', handleMouseMove);
        }

        htmlElement.on('mouseup touchend', handleMouseUp);

        scope.$watch('splitbar.size', function(newValue) {
          element.css(ctrl.sizeProperties.sizeProperty, newValue + 'px');
        });

        scope.splitbar.updatePosition = function() {
          element.css(ctrl.sizeProperties.flowProperty, scope.splitbar.position + 'px');
        };

        scope.splitbar.update = function() {
          scope.splitbar.updatePosition();
        };

        scope.$watch('splitbar.position', scope.splitbar.updatePosition);

        //Add splitbar to layout container list
        ctrl.addContainer(scope.splitbar);

        // initialize the button visibility according to the collapsed state of the adjacent containers:
        var index = ctrl.containers.indexOf(scope.splitbar);
        var before = ctrl.containers[index - 1];
        var after = ctrl.containers[index + 1];
        if (before) {
          scope.splitbar.notifyToggleBefore(before.collapsed);
        }
        if (after) {
          scope.splitbar.notifyToggleAfter(after.collapsed);
        }

        element.on('$destroy', function() {
          ctrl.removeContainer(scope.splitbar);
          htmlElement.off('mouseup touchend', handleMouseUp);
          htmlElement.off('mousemove touchmove', handleMouseMove);
          scope.$evalAsync();
        });
      }
    };

  }])

  .directive('uiLayoutContainer',
    ['LayoutContainer', '$compile', '$window',
      function(LayoutContainer, $compile, $window) {
        return {
          restrict: 'AE',
          require: '^uiLayout',
          scope: true,
          compile: function() {
            return {
              pre: function(scope, element, attrs, ctrl) {

                scope.container = LayoutContainer.Container();
                scope.container.element = element;
                scope.container.id = element.attr('id') || null;
                scope.container.layoutId = ctrl.id;
                scope.container.isCentral = attrs.uiLayoutContainer === 'central';

                if (angular.isDefined(attrs.resizable)) {
                  scope.container.resizable = scope.$eval(attrs.resizable);
                }
                scope.container.size = attrs.size;

                scope.container.minSize = attrs.minSize;
                scope.container.maxSize = attrs.maxSize;
                ctrl.addContainer(scope.container);

                element.on('$destroy', function() {
                  ctrl.removeContainer(scope.container);
                  scope.$evalAsync();
                });
              },
              post: function(scope, element, attrs, ctrl) {
                if(!element.hasClass('stretch')) element.addClass('stretch');
                if(!element.hasClass('ui-layout-container')) element.addClass('ui-layout-container');

                if (ctrl.animate === 'true') {
                  var animationClass = ctrl.isUsingColumnFlow ? 'animate-column' : 'animate-row';
                  element.addClass(animationClass);
                }

                 function loadContainerState(def) {
                  // load uncollapsedSize from local storage if available:
                  scope.container.uncollapsedSize = null;
                  if($window.localStorage !== undefined) {
                    scope.container.uncollapsedSize = $window.localStorage.getItem(scope.container.storageId);
                  }
                  if(scope.container.uncollapsedSize === null) {
                    scope.container.uncollapsedSize = def;
                  }
                }

                loadContainerState(null);
                var sizeInitialised;
                attrs.$observe('size', function(size) {
                  if (!sizeInitialised) {
                    loadContainerState(size);
                    sizeInitialised = true;
                  } else {
                    scope.container.uncollapsedSize = size;
                  }
                  ctrl.calculate();
                });
                attrs.$observe('minSize', function(minSize) {
                  scope.container.minSize = minSize;
                  ctrl.calculate();
                });
                attrs.$observe('maxSize', function(maxSize) {
                  scope.container.maxSize = maxSize;
                  ctrl.calculate();
                });

                scope.$watch(attrs.collapsed, function (collapsed) {
                  if (angular.isDefined(collapsed)) {
                    scope.container.collapsed = collapsed;
                    ctrl.processToggleContainer(ctrl.containers.indexOf(scope.container));
                  }
                });

                scope.container.updateSize = function() {
                  element.css(ctrl.sizeProperties.sizeProperty, scope.container.size + 'px');
                  scope.$broadcast('ui.layout.resize', scope.container);
                };

                scope.$watch('container.size', function(newValue) {
                  scope.container.updateSize();
                  if(newValue === 0) {
                    element.addClass('ui-layout-hidden');
                  } else {
                    element.removeClass('ui-layout-hidden');
                  }
                });

                scope.container.updatePosition = function() {
                  element.css(ctrl.sizeProperties.flowProperty, scope.container.position + 'px');
                };

                scope.container.update = function() {
                  scope.container.updatePosition();
                  scope.container.updateSize();
                };

                scope.$watch('container.position', scope.container.updatePosition);

                //TODO: add ability to disable auto-adding a splitbar after the container
                var parent = element.parent();
                var children = parent.children();
                var index = ctrl.indexOfElement(element);
                var splitbar = angular.element('<div ui-splitbar>' +
                  '<a><span class="ui-splitbar-icon ui-splitbar-toggle"></span></a>' +
                  '<a class="ui-splitbar-handle-container"><span class="ui-splitbar-icon ui-splitbar-handle"></span></a>' +
                  '<a><span class="ui-splitbar-icon ui-splitbar-toggle"></span></a>' +
                  '</div>');
                if(0 < index && !ctrl.hasSplitbarBefore(scope.container)) {
                  angular.element(children[index-1]).after(splitbar);
                  $compile(splitbar)(scope);
                } else if(index < children.length - 1) {
                  element.after(splitbar);
                  $compile(splitbar)(scope);
                }
              }
            };
          }
        };
      }])

  .directive('uiLayoutLoaded', [function() {
    // This is not needed any more, because toggling does not depend on the logic
    // of prevButton and nextButton. It is only kept to simulate the previous
    // behaviour and avoid a breaking change. It should be removed with the next
    // major version upgrade.
    return {
      require: '^uiLayout',
      restrict: 'A',
      priority: -100,
      link: function($scope, el, attrs){
        // negation is safe here, because we are expecting non-empty string
        if (!attrs['uiLayoutLoaded']) {
          $scope.$broadcast('ui.layout.loaded', null);
        } else {
          $scope.$broadcast('ui.layout.loaded',  attrs['uiLayoutLoaded']);
        }
      }
    };
  }])

  .factory('LayoutContainer', function() {
    function BaseContainer() {

      /**
       * Stores element's id if provided
       * @type {string}
       */
      this.id = null;

      /**
       * Id of the parent layout
       * @type {number}
       */
      this.layoutId = null;

      /**
       * Central container that is always resized
       * @type {boolean}
       */
      this.isCentral = false;

      /**
       * actual size of the container, which is changed on every updateDisplay
       * @type {any}
       */
      this.size = 'auto';

      /**
       * cache for the last uncollapsed size
       * @type {any}
       */
      this.uncollapsedSize = null;

      this.maxSize = null;
      this.minSize = null;
      this.resizable = true;
      this.element = null;
      this.collapsed = false;
    }

    // Splitbar container
    function SplitbarContainer() {
      this.size = 10;
      this.position = 0;
      this.element = null;
      this.collapsed = false;
    }

    return {
      Container: function(initialSize) {
        return new BaseContainer(initialSize);
      },
      Splitbar: function() {
        return new SplitbarContainer();
      },
      isSplitbar: function(container) {
        return container instanceof SplitbarContainer;
      }
    };
  })
;
